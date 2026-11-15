# ADR-0009: Müsaitlik cache'i: kısa TTL + invalidasyon, rezervasyon yolu cache'e bakmaz

- **Durum:** Kabul edildi, uygulandı ve test edildi (`CachedAvailability`).
- **İlgili maddeler:** S6

## Bağlam

Müsaitlik sorgusu her ziyaretçide, her tarih değişiminde çalışır ve iki sorgu yapar; stok ise yalnızca rezervasyon/iptalde değişir. Okuma yazmadan çok daha sık. Ama cache **yanlış satış** üretmemeli: overbooking güvencesi ADR-0002'de ve ona dokunulmamalı.

## Karar

Süreç içi (bellek) cache, `CachedAvailability`:

1. **Cache yalnızca okumadır.** Rezervasyon ve iptal cache'e hiç bakmaz; tek otorite koşullu `UPDATE`'tir (ADR-0002). Bayat bir cache en kötü, satılmış bir odayı "müsait" gösterir; sonuç temiz bir `409 SOLD_OUT`'tur, asla fazla satış değil.
2. **Üç yönlü bayatlık sınırı:**
   - **TTL** (varsayılan 10 sn, `AVAILABILITY_CACHE_TTL_MS`; `0` = kapalı).
   - **Invalidasyon:** her rezervasyon, iptal ve **SOLD_OUT** o otelin tüm cevaplarını siler (aynı süreçte "yazdığını oku"). SOLD_OUT'ta silmek cache'i kendiliğinden iyileştirir: bayat olduğunu kanıtlayan olay tetikler.
   - **Nesil kontrolü:** bir cevap hesaplanırken stok değişirse (invalidasyon araya girerse) o cevap **saklanmaz**; yoksa invalidasyondan sonra bayat veri cache'e yazılabilirdi.
3. **Single flight:** aynı anahtara eş zamanlı gelen kaçırmalar tek hesaplamayı paylaşır (25 eş zamanlı istek → 1 sorgu).
4. **Hatalar cache'lenmez** (doğrulama 422'si, veritabanı hatası).
5. **Sınırlı bellek:** en fazla 1000 cevap, en eskisi atılır. Anahtar: otel + tarihler + kişi sayıları.
6. **Tarayıcıda cache yok:** yanıt hâlâ `Cache-Control: no-store`; yalnızca sunucu cache'ler. `X-Cache: HIT|MISS|OFF` başlığı davranışı görünür kılar.

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| Redis ile paylaşımlı cache | Çok kopyada tutarlı invalidasyon sağlar ama yeni altyapı ve ağ gecikmesi getirir; iki pilot otel için bellek yeterli. Ölçek gerektirince Redis'e geçiş `CachedAvailability` arkasında yapılabilir. |
| Tarayıcı/CDN cache (`max-age`) | Bayat veri kontrolümüz dışında; invalidasyon imkânsız. |
| Cache'i rezervasyon doğrulamasında kullanmak | Overbooking güvencesini zayıflatırdı. |
| Her yazmada cache'i güncellemek (write-through) | Fiyat/oda tipi/gece kombinasyonları çok; silmek güncellemekten basit ve güvenli. |

## Sonuçlar

- (+) Tekrarlayan aramalar veritabanına gitmez; ani trafik tek sorguya iner.
- (+) Aynı süreçte bayatlık yok (invalidasyon); testle kanıtlı: rezervasyon sonrası `remaining` hemen düşer, iptal sonrası hemen artar.
- (−) **Çok kopyada** bir kopyanın rezervasyonu diğerinin cache'ini TTL'e (≤10 sn) kadar bayat bırakır. Bilinçli: sonuç `SOLD_OUT` + iyileşen cache (testle gösterilen senaryo).
- (−) Cache kopya başına; soğuk başlangıçta boş.
- **Doğrulama:** `availability-cache.test.ts` (birim: TTL, anahtarlar, otel bazlı invalidasyon, single flight, nesil kontrolü, hata, sınır) ve `availability-cache.test.ts` (entegrasyon: HIT/MISS, rezervasyon/iptal invalidasyonu, bayat cache'te SOLD_OUT ve iyileşme).
