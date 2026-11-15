# ADR-0004: Tenant çözümü ve CORS: otel anahtarı URL yolunda

- **Durum:** Kabul edildi ve uygulandı (`modules/tenancy`).
- **İlgili maddeler:** M1, M9, güvenlik beklentisi (CORS yalnızca otelin domain'lerine açık)

## Bağlam

Widget herkese açık bir otel anahtarıyla çalışır (gizli değil). Her istek tek bir otele ait olmalı ve bir otelin verisi başka otelden görülememeli. CORS yalnızca **o otelin** tanımlı domain'lerine açık olmalı: Lagos'un sitesi, Peri'nin anahtarıyla tarayıcıdan istek yapabilmemeli.

Kritik kısıt: tarayıcı, özel header içeren (ör. `Idempotency-Key`) isteklerden önce bir **preflight (`OPTIONS`)** gönderir ve preflight'ta özel header'ların **değerleri yoktur**, yalnızca isimleri listelenir. Sunucu bu noktada hangi otelin izin listesini uygulayacağını yalnızca **URL'den** bilebilir.

## Karar

- Anahtar yolun parçasıdır: `/v1/public/{hotelKey}/availability`, `/v1/public/{hotelKey}/reservations`, …
- `/v1/public/:hotelKey` altındaki **tüm** route'lar tek bir Fastify scope'unda kayıtlıdır. Scope'taki `onRequest` hook'u anahtarı otele çözer (`request.hotel`), otelin kendi CORS kararını uygular ve ancak ondan sonra handler'a geçer. Tenant çözülmeden çalışabilen bir public route olamaz.
- CORS kararı saf bir fonksiyondur (`decideCors`) ve test edilir:
  - `Origin` otelin `allowed_origins` listesinde **birebir** eşleşiyorsa → `Access-Control-Allow-Origin: <origin>` + `Vary: Origin`; preflight ise izin verilen metotlar/header'lar (`Idempotency-Key` dahil).
  - Listede yoksa → `403 ORIGIN_NOT_ALLOWED`, CORS header'ı yok (başka otelin origin'i dahil).
  - `Origin` header'ı yoksa (curl, sunucu-sunucu) → geçer. CORS bir kimlik doğrulama değildir; anahtar zaten herkese açıktır. CORS, ziyaretçilerin tarayıcılarını korur.
- Eşleşme birebir: joker yok, sonek/önek eşleşmesi yok (`evil-lagos…` geçemez). İzin listesi veritabanında (`hotels.allowed_origins`) olduğu için domain eklemek deploy gerektirmez; yazılırken normalize edilip doğrulanır.
- Veri izolasyonu iki katmanlı: (1) her repository sorgusu `hotel_id` ile filtreler; (2) bileşik yabancı anahtar `inventory(hotel_id, room_type_id) → room_types(hotel_id, id)` bir otelin satırının başka otelin oda tipine bağlanmasını **veritabanında** imkânsız kılar.
- CRM uçları token ister ve `hotel_id` token'dan gelir, istemciden alınmaz (opak bearer token, bkz. [ADR-0010](0010-crm-staff-access-and-panel-security.md)).

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| `X-Hotel-Key` header'ı | Preflight'ta değer görünmez → hangi otelin listesi uygulanacağı bilinemez; çözüm "tüm otellerin domain'lerinin birleşimine izin vermek" olur ve Lagos sayfası Peri anahtarını kullanabilir. |
| `?key=` sorgu parametresi | Preflight'ı çözer ama anahtar log/Referer/cache anahtarlarına karışır; yol daha temiz ve cache dostu. |
| Otel başına alt alan adı (`lagos.api…`) | Temiz bir izolasyon, ama joker DNS + TLS sertifikası ve ek altyapı gerektirir; iki pilot otel için aşırı. |
| Global `@fastify/cors` | Tek bir statik/dinamik liste; yine hangi otel olduğunu preflight'ta bilmesi gerekir, yani yine URL'de anahtar şart. |
| PostgreSQL Row-Level Security | Unutulan `WHERE hotel_id` hatasına karşı güçlü bir sigorta; ancak her transaction'da `SET LOCAL app.hotel_id` ve bağlantı havuzu yönetimi gerektirir. Bu ölçekte kazancı karmaşıklığına değmedi. |

## Sonuçlar

- (+) Preflight doğru otelin listesine göre yanıtlanır; yanlış otelin anahtarı yanlış domain'den tarayıcıda kullanılamaz.
- (+) Tenant çözümü tek noktada; handler'lar `request.hotel`'e güvenir.
- (−) Anahtar herkese açık olduğundan kötüye kullanım (tarama, yoğun istek) için hız sınırlama gerekir (şu an yok, bilinen eksik).
- (−) Sunucu tarafı `Origin` reddi, sahte `Origin` gönderebilen sunucu-sunucu istemcileri durdurmaz; bu bilinçli bir sınırdır (CORS yetkilendirme değildir).
