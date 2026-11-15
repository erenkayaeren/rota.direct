# ADR-0005: Idempotent rezervasyon: `Idempotency-Key` + aynı transaction'da talep (claim)

- **Durum:** Kabul edildi, uygulandı ve test edildi.
- **İlgili maddeler:** M6, M7

## Bağlam

Widget `POST /reservations` isteğini ağ zaman aşımı, çift tıklama veya tarayıcının yeniden denemesi yüzünden birden fazla kez gönderebilir. İstek sunucuda başarıyla işlenmiş ama yanıt istemciye ulaşmamış olabilir. Aynı misafir için iki rezervasyon ve iki kat stok düşmesi kabul edilemez.

## Karar

1. İstemci her **niyet** için bir `Idempotency-Key` başlığı üretir (UUID önerilir; 16-128 karakter) ve yeniden denemelerde **aynı** anahtarı gönderir. Başlık zorunludur (yoksa `400`).
2. Anahtar `idempotency_keys(hotel_id, key)` tablosunda tutulur. **Otel başına** kapsamlıdır: iki otel aynı anahtarı kullanabilir, birbirinin yanıtını göremez.
3. Rezervasyon transaction'ı **önce anahtarı talep eder** (`INSERT … ON CONFLICT DO NOTHING`), sonra stoğu düşer, rezervasyonu ve outbox olayını yazar, en sonda yanıtı anahtara kaydeder. Hepsi **tek transaction**.
4. Talep sonucu:
   - **claimed:** anahtar yeni; normal akış sürer.
   - **replay:** anahtar daha önce *commit edilmiş* ve istek içeriği aynı → saklanan yanıt (`201` + aynı gövde) **aynen** döner, `Idempotent-Replayed: true` başlığıyla. Stok ve tablolara dokunulmaz.
   - **conflict:** aynı anahtar, farklı istek → `422 IDEMPOTENCY_KEY_REUSED`.
5. "Aynı istek" = **normalize edilmiş** isteğin SHA-256'sı (oda tipi, tarihler, kişi sayıları, temizlenmiş misafir bilgisi, pazarlama izni). `"AYSE@x.com "` ile `"ayse@x.com"` aynı istektir.

### Neden "önce talep et"

Anahtarı en sonda yazsaydık, aynı anahtarla iki eş zamanlı istek ikisi de stok düşer, ikincisi sonda birincil anahtar çakışmasıyla geri alınırdı. Son odada bu, yeniden denemenin `SOLD_OUT` almasına yol açardı (birinci istek odayı almış, ikincisi görmüş). Başta talep edince eş zamanlı ikinci istek `INSERT` satırında **birincinin bitmesini bekler**: birincisi commit ederse ikincisi `replay` alır; geri alırsa (ör. `SOLD_OUT`) anahtar boşalır ve ikincisi kendi şansını dener.

### Başarısız denemeler anahtar bırakmaz

`SOLD_OUT` gibi bir hatada transaction geri alınır; anahtar da onunla birlikte silinir. Misafir bir oda boşaldığında **aynı anahtarla** tekrar deneyebilir. Hata yanıtları saklanıp tekrar oynatılmaz. Bu bilinçli: geçici bir "dolu" cevabı kalıcılaşmamalı.

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| Anahtarı sonda yaz (yalnızca benzersizlik) | Yukarıdaki yarış: yeniden deneme yanlışlıkla `SOLD_OUT` alabilir. |
| İstek içeriğinden otomatik tekilleştirme (aynı e-posta + tarih) | Aynı kişi aynı tarihlere gerçekten iki oda isteyebilir; niyeti yalnızca istemci bilir. |
| Redis `SET NX` ile kilit | Rezervasyonla aynı transaction'da olmaz; çökme anında ikisi birbirinden sapar. |
| Hata yanıtlarını da sakla | Geçici `SOLD_OUT` kalıcılaşır; misafir oda açılsa bile aynı anahtarla hata alırdı. |

## Sonuçlar

- (+) Çift rezervasyon ve çift stok düşmesi, eş zamanlı yeniden denemelerde bile imkânsız; testle kanıtlı (10 paralel istek → 1 rezervasyon, 9 replay).
- (+) Replay yanıtı bire bir aynıdır (`createdAt` dahil), çünkü yanıt gövdesi saklanır, yeniden hesaplanmaz.
- (−) Anahtar tablosu büyür. **Bilinen eksik:** TTL temizliği (ör. 24 saat sonra silme) henüz yok.
- (−) Replay, doğrulamadan **sonra** oynatılır: aynı anahtarla geç gelen bir yeniden deneme, o arada tarih "geçmişe" döndüyse (check-in = dün) replay yerine `422 CHECK_IN_IN_PAST` alır. Pratik etkisi çok küçük (anahtar zaten kısa ömürlü olmalı); TTL ile birlikte ele alınacak.
- (−) İptal uç noktası anahtar kullanmaz; ikinci iptal `409 INVALID_STATE_TRANSITION` döner. İstemci için güvenli ve anlaşılır (zaten iptal edilmiş).
