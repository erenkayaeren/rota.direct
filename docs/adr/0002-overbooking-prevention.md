# ADR-0002: Overbooking önleme: koşullu atomik UPDATE + CHECK kısıtı

- **Durum:** Kabul edildi ve uygulandı. Şema ve `CHECK` kısıtı, rezervasyon/iptal use case'leri ve eşzamanlılık testleri teslim edildi (`PgInventoryStock`, `test/integration/concurrency.test.ts`).
- **İlgili maddeler:** M5, M6, M8

## Bağlam

Aynı son odaya aynı anda iki istek geldiğinde yalnızca biri başarılı olmalı. Envanter, her otel + oda tipi + gece için bir satır olarak tutuluyor:

```
inventory(hotel_id, room_type_id, stay_date, total, booked)   PRIMARY KEY (hotel_id, room_type_id, stay_date)
CONSTRAINT inventory_no_overbooking CHECK (booked <= total)
```

Bir rezervasyon birden çok gece (satır) tüketir ve hepsi ya birlikte düşer ya hiçbiri.

## Karar

Rezervasyon tek transaction içinde, kontrol ile artırmayı **tek SQL ifadesinde** birleştirir:

```sql
UPDATE inventory
SET booked = booked + 1
WHERE hotel_id = $1 AND room_type_id = $2
  AND stay_date >= $3 AND stay_date < $4      -- check-out gecesi hariç
  AND booked < total;
```

Etkilenen satır sayısı gece sayısına eşit değilse (en az bir gece dolu) transaction **geri alınır** ve `409 SOLD_OUT` döner. Rezervasyon satırı ve `outbox` olayı aynı transaction'da yazılır.

Neden doğru: Postgres `UPDATE` sırasında satırı kilitler. Aynı satırı güncellemeye çalışan ikinci transaction, ilki commit edene kadar bekler ve `READ COMMITTED` altında `WHERE` koşulunu **güncel satır sürümüne karşı yeniden değerlendirir**; `booked < total` artık yanlışsa satırı atlar. "Önce oku, sonra yaz" aralığı olmadığı için yarış yoktur. `CHECK (booked <= total)` ise uygulama kodu yanlış olsa bile veritabanının son savunma hattıdır (`database.test.ts` kanıtlıyor).

İptalde envanter geri açılır: `booked = booked - 1 WHERE booked > 0`; çift iptal durum makinesiyle (S1) engellenir.

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| `SELECT … FOR UPDATE` → kontrol → `UPDATE` | Doğru ama iki tur ve daha uzun kilit süresi; kontrolü uygulama kodunda yapmak hataya açık. |
| Optimistic locking (`version` kolonu) + retry | Son odaya gelen N istekten N-1'i boşa çalışıp yeniden dener; çekişmede verimsiz. |
| Advisory lock (otel + oda tipi) | Basit serileştirme sağlar ama tüm yazanların kurala uymasını gerektirir; yine de DB kısıtı şart. |
| `SERIALIZABLE` + retry | Doğru ama `40001` hataları ve retry döngüsü bu problem için gereğinden ağır. |
| Uygulama içi mutex / Redis kilidi | Çok instance'ta veritabanından bağımsız ikinci bir doğruluk kaynağı; en zayıf seçenek. |

## Sonuçlar

- (+) Basit, hızlı ve veritabanı seviyesinde kanıtlanabilir; son savunma `CHECK`.
- (−) Aynı satırlara yazan rezervasyonlar sıraya girer (kısa süreli bekleme). Çakışan tarih aralıkları farklı sırada kilitlenirse deadlock (`40P01`) teorik olarak mümkündür; tek ifade ve indeks sırası bunu pratikte önler, yine de `withTransaction` bu durumda (`40P01`, `40001`) işlemi baştan, en fazla 4 kez dener; transaction yalnızca veritabanına dokunduğu için tekrar çalıştırmak güvenlidir.
- **Doğrulama:**
  - 1 oda kalmışken 15 paralel istek → tam 1 `201`, 14 `409 SOLD_OUT`, `booked = total`, tek rezervasyon satırı.
  - 5 odalı tipe 25 paralel istek → tam 5 `201`.
  - Üst üste binen 40-60 rastgele aralık → yalnızca `201`/`409`; her gece için `booked` = o geceyi kapsayan onaylı rezervasyon sayısı ve `≤ total` (kısmi konaklama yok).
  - Aynı rezervasyonu 6 paralel iptal → 1 başarı, 5 `409`; odalar bir kez geri açılır.
  - **Negatif kontrol:** `AND booked < total` koşulu kaldırıldığında bu testler başarısız olur; yani testler gerçekten bu koşulu ölçüyor.
