# Rota Direct

Otellerin kendi sitesine tek satır script ile gömebildiği **rezervasyon widget'ı** ve rezervasyonlardan beslenen basit bir **misafir CRM'i** (case study: *Otel Rezervasyon Widget'ı ve Turizm CRM*).

Ürün ilk olarak iki pilot otelde çalışacağı için sistem baştan **çok kiracılı (multi-tenant)** tasarlandı; her otel bir kiracıdır.

## İçindekiler

1. [Tek komutla kurulum](#tek-komutla-kurulum)
2. [Kapsam durumu](#kapsam-durumu)
3. [Mimari](#mimari)
4. [Teknoloji seçimleri ve gerekçeleri](#teknoloji-seçimleri-ve-gerekçeleri)
5. [Önemli tasarım kararları](#önemli-tasarım-kararları)
6. [Varsayımlar](#varsayımlar)
7. [API](#api)
8. [Test](#test)
9. [Bilinen eksikler](#bilinen-eksikler)
10. [Repo yapısı](#repo-yapısı)

## Tek komutla kurulum

Gereken tek şey Docker (Compose v2). Yerel Node/Postgres kurulumu gerekmez.

```bash
docker compose up --build
```

Sıra: `postgres` (healthy) → `reservation-bootstrap` (migration + demo otel seed'i + envanter satırları, bitince çıkar) → `reservation` (health check'li servis, `http://localhost:3000`).

Deneme (Linux/WSL için `date -d`, macOS için `date -v+7d +%F`; tarihler bugünden sonra olmalı):

```bash
CHECK_IN=$(date -d '+7 days' +%F); CHECK_OUT=$(date -d '+10 days' +%F)
curl -s "http://localhost:3000/v1/public/pk_lagos_beach_demo/availability?checkIn=$CHECK_IN&checkOut=$CHECK_OUT&adults=2&children=0"
```

Demo otel anahtarları (herkese açık anahtarlardır, gizli değildir):

| Otel | `data-hotel-key` | İzinli origin'ler |
|---|---|---|
| Lagos Beach Hotel (Antalya) | `pk_lagos_beach_demo` | `https://www.lagosbeachhotel.example`, `http://localhost:8080` |
| Peri Stone Cave Hotel (Kapadokya) | `pk_peri_stone_demo` | `https://www.peristonecave.example`, `http://localhost:8080` |

`http://localhost:8080` geliştirme sırasındaki demo host sayfası içindir; gerçek bir otelde kaldırılmalıdır.

Durdurmak için `docker compose down` (veriyi de silmek için `-v`).

## Kapsam durumu

| Madde | Durum | Not |
|---|---|---|
| M5 Müsaitlik API'si | ✅ | Gece bazında, oda tipi bazında; check-out gecesi hariç |
| M9 Çok kiracılılık | ✅ | Tenant scope'u + per-otel CORS + iki katmanlı veri izolasyonu ([ADR-0004](docs/adr/0004-tenant-resolution-and-cors.md)) |
| M2 Arama doğrulaması | 🟡 | Sunucu tarafı (geçmiş tarih, ters aralık, kapasite aşımı…) ✅; widget formu henüz yok |
| M3 Sonuç listesi | 🟡 | API (fiyat, toplam, kalan oda) ✅; arayüz henüz yok |
| M13 / S5 Docker | 🟡 | Compose, çok aşamalı imaj, non-root kullanıcı, health check, bağımlılık sırası var; diğer servisler eklendikçe tamamlanır |
| M6 M7 M8 S1 Rezervasyon, idempotency, iptal, durum makinesi | ⏳ | Şema ve `CHECK` kısıtı hazır ([ADR-0002](docs/adr/0002-overbooking-prevention.md)) |
| M10 M11 S2 Olaylar, misafir profili, PMS | ⏳ | |
| M1 M4 M12 S3 S4 Widget, CRM paneli | ⏳ | [ADR-0003](docs/adr/0003-widget-isolation-shadow-dom.md) |
| S6 Cache | ⏳ | Müsaitlik yanıtı şimdilik tarayıcıda cache'lenmez (`no-store`) |
| B1–B6 | ⏭️ Bilinçli atlanacak | Kapsam dışı |

## Mimari

```
        Otel sitesi
   <script src=".../widget.js" data-hotel-key="...">
            │  GET /v1/public/{hotelKey}/availability
            ▼
┌───────────────────────── reservation-service (modüler monolit) ─────────────────────────┐
│  http ─► application ─► domain  ◄── infra (Postgres)                                    │
│                                                                                         │
│  tenancy ◄── inventory ◄── reservation                                                  │
│  (otel, CORS)  (müsaitlik)   (rezervasyon, idempotency, outbox)                         │
└──────────────┬──────────────────────────────────────────────────┬───────────────────────┘
               │ outbox ► broker                                  │ bildirim
               ▼                                                  ▼
        crm-service ── CRM paneli                           pms-mock (retry + dead-letter)
        (yalnızca olaylardan beslenir)                      (hata durumunda kayıpsız)
```

Bu sürümde **yalnızca** `reservation-service` (tenancy + inventory) ve PostgreSQL vardır. Gerekçe için [ADR-0001](docs/adr/0001-module-boundaries-and-event-driven-crm.md).

**Katmanlar (her modülde aynı):**

| Katman | İçerik | İzinli bağımlılık |
|---|---|---|
| `domain/` | Saf iş kuralı (tarih kuralları, müsaitlik hesabı) | Yalnızca `shared/` |
| `application/` | Use case'ler ve port arayüzleri | `domain/`, `shared/` |
| `infra/` | Port'ların Postgres adaptörleri | `application/`, `domain/` |
| `http/` | Fastify route'ları, giriş/çıkış dönüşümü | `application/`, `domain/` |

Bu kurallar yorum değil, **test**: `test/unit/architecture.test.ts` domain'in framework/driver import etmediğini, `tenancy`'nin `inventory`'ye bağımlı olmadığını doğrular. `app.ts` hangi port'u hangi adaptörün uyguladığını bilen tek yerdir (composition root).

## Teknoloji seçimleri ve gerekçeleri

| Konu | Seçim | Gerekçe | Alternatif |
|---|---|---|---|
| Dil | TypeScript (Node 22) | Domain modelini tiple ifade etmek (ör. `LocalDate`), widget ile aynı dil | Java/Spring, .NET |
| HTTP | Fastify 5 | Encapsulation + hook modeli tenant scope'una birebir oturuyor; küçük ve hızlı | NestJS (bu ölçek için fazla yapı/sihir), Express (scope/hook modeli yok) |
| Veritabanı | PostgreSQL 16 | Transaction, `CHECK`/bileşik FK kısıtları, atomik `UPDATE`, `DATE` tipi; overbooking'i veritabanı seviyesinde kanıtlayabilmek | MySQL, MongoDB (kısıt yok), Redis (envanter için dayanıksız) |
| DB erişimi | `pg` + elle SQL | Envanter mantığının özü SQL; ORM tam burada gizlerdi | Prisma, Drizzle, Knex |
| Migration | Kendi küçük runner'ım (checksum + advisory lock) | ~60 satır, bağımlılık yok, uygulanmış migration'ın değiştirilmesini yakalar | node-pg-migrate, Flyway |
| Doğrulama | zod | Çalışma zamanı şeması; format hataları (400) ile iş kuralları (422) ayrı | Fastify/ajv JSON Schema |
| Test | Vitest | TypeScript'i doğrudan çalıştırır, hızlı | Jest |
| Mesajlaşma | Outbox + RabbitMQ | Bu ölçek için Kafka fazla; Redis Streams da olabilir. Karar ADR'de belgelenir | Kafka, Redis Streams |
| Widget | Preact + Vite + Shadow DOM | Küçük bundle (B5), garanti edilmiş stil izolasyonu ([ADR-0003](docs/adr/0003-widget-isolation-shadow-dom.md)) | React, iframe |
| Konteyner | Çok aşamalı Dockerfile, `node:22-alpine`, root olmayan `node` kullanıcısı | Küçük, saldırı yüzeyi dar imaj; `test` hedefi aynı Dockerfile'dan | Tek aşamalı imaj |

## Önemli tasarım kararları

Büyük kararların tam gerekçesi ADR'lerde: [0001 modül sınırları](docs/adr/0001-module-boundaries-and-event-driven-crm.md) · [0002 overbooking](docs/adr/0002-overbooking-prevention.md) · [0003 widget izolasyonu](docs/adr/0003-widget-isolation-shadow-dom.md) · [0004 tenant ve CORS](docs/adr/0004-tenant-resolution-and-cors.md). Kısa liste:

- **Envanter, gece başına satır.** `inventory(hotel_id, room_type_id, stay_date, total, booked)`. Müsaitlik "her gecede en az bir oda boş mu" sorusu olur ve rezervasyon bu satırları tek `UPDATE` ile düşer. `total` satırda tutulur: tek bir gece için stop-sell/bakım, diğer tarihlere dokunmadan yapılabilir.
- **Envanter ufku.** Satırlar bugünden 400 gün ileriye kadar önceden oluşturulur (`ensureInventoryHorizon`); rezervasyon penceresi 365 gün. Bootstrap'ta ve serviste 6 saatte bir çalışır; idempotenttir (mevcut satırlara ve rezervasyon sayılarına dokunmaz). Satırı olmayan bir gece "satışta değil" sayılır.
- **Check-out günü gece değildir.** Misafir o sabah ayrılır; `[checkIn, checkOut)` aralığı.
- **Tarih = saat dilimsiz takvim günü.** Tarihler uçtan uca `YYYY-MM-DD` string'idir (HTTP → domain → Postgres `DATE`), hiçbir yerde JS `Date` değil; sunucunun UTC farkı günü kaydıramaz. "Bugün", sunucunun değil **otelin** saat dilimindedir (`Europe/Istanbul`): UTC 22:30'da Antalya'da saat 01:30 ve ertesi gündür, yani "dünün" rezervasyonu reddedilir (unit testle doğrulanıyor).
- **Para = tam sayı kuruş.** `320000` = 3.200 TRY; kayan nokta yok.
- **Hata modeli.** Tek JSON şekli `{ "error": { "code", "message", "details"? } }`. Biçim hataları `400 INVALID_REQUEST`, iş kuralı ihlalleri `422` + kararlı bir `code` (widget TR/EN metni kod üzerinden seçer, mesajı ayrıştırmaz). Beklenmeyen hatalarda iç ayrıntı istemciye sızmaz.
- **Tenant, scope düzeyinde.** `/v1/public/:hotelKey` altındaki her route, otel çözülmeden çalışamaz; `request.hotel` handler'lara hazır gelir. Repository sorguları `hotel_id` ile filtreler, bileşik FK başka otelin satırına bağlanmayı veritabanında engeller.
- **Müsaitlik yanıtı `Cache-Control: no-store`.** Stok her rezervasyonda değişir; sunucu tarafı cache (S6) invalidasyonla birlikte eklenecek.
- **Saf fonksiyonlar.** CORS kararı, hata eşleme, sorgu ayrıştırma çerçeveden bağımsız saf fonksiyonlar; Fastify bunların ince bir kabuğu. Bu, unit test edilebilirliği artırır.

## Varsayımlar

Case metninin açıkça söylemediği yerlerde alınan kararlar:

- **Maksimum kişi = yetişkin + çocuk.** Çocuk yaşı alınmıyor; çocuk da kapasiteye sayılır (muhafazakâr).
- Yalnızca partiye **sığan** ve tüm gecelerinde **boş** oda tipleri döner; dolu tipler listelenmez. Hiçbir oda tipi partiyi barındıramıyorsa `422 CAPACITY_EXCEEDED`.
- En az 1 yetişkin; en fazla 10 yetişkin ve 10 çocuk. En fazla **30 gece**. Konaklama bugünden itibaren **365 gün** içinde bitmeli.
- Fiyat, oda tipinin sabit gecelik fiyatıdır (hafta sonu farkı gibi kurallar B3 kapsamı). Para birimi otelin para birimidir (TRY).
- Ödeme yok: "ödeme otelde" varsayımı. E-posta gönderimi log'a yazılacak.

## API

Tam sözleşme: [`docs/api/openapi.yaml`](docs/api/openapi.yaml). Uçlar:

| Uç | Açıklama |
|---|---|
| `GET /v1/public/{hotelKey}/availability?checkIn&checkOut&adults&children` | Müsaitlik (M5) |
| `OPTIONS /v1/public/{hotelKey}/*` | Per-otel CORS preflight |
| `GET /health/live`, `GET /health/ready` | Süreç ve veritabanı sağlığı |

Örnek yanıt (2 yetişkin, 3 gece, Lagos):

```json
{
  "stay": { "checkIn": "2026-11-01", "checkOut": "2026-11-04", "nights": 3, "adults": 2, "children": 0 },
  "roomTypes": [
    {
      "id": "…", "code": "standard", "name": { "tr": "Standart", "en": "Standard" }, "maxGuests": 2,
      "nightlyPrice": { "amountMinor": 320000, "currency": "TRY" },
      "totalPrice": { "amountMinor": 960000, "currency": "TRY" },
      "remaining": 20
    }
  ]
}
```

## Test

Üç katman:

| Katman | Ne test eder | Dosyalar |
|---|---|---|
| Unit | Tarih/kişi kuralları, müsaitlik hesabı (min-over-nights, check-out hariç, kapasite), saat dilimi, CORS kararı, hata eşleme, sorgu ayrıştırma, modül sınırları | `test/unit/**` |
| Integration (API) | Gerçek Postgres + `app.inject`: müsaitlik, doğrulama, tenant izolasyonu, per-otel CORS (preflight dahil), health | `test/integration/availability.api.test.ts` |
| Integration (DB) | `CHECK (booked <= total)`, bileşik FK, seed, ufuk/seed'in mevcut rezervasyonları bozmaması, migrator (idempotency, checksum sapması) | `test/integration/database.test.ts` |

Çalıştırma (Docker ile, yerel kurulum gerekmez):

```bash
docker compose --profile test run --rm reservation-test
```

Yerelde: `cd services/reservation && npm install`, ardından Postgres'e `CREATE DATABASE` yetkisi olan bir kullanıcıyla `TEST_DATABASE_URL=postgres://rota:rota_dev_password@localhost:5432/postgres npm test`. Her test dosyası kendi geçici veritabanını yaratıp siler, bu yüzden dosyalar paralel çalışır ve testler envanteri serbestçe değiştirebilir.

Zorunlu **M6 eşzamanlılık testi** (1 oda kalmışken N paralel istek → tam 1 başarı) rezervasyon use case'iyle birlikte gelecek.

## Bilinen eksikler

- **Hız sınırlama / kötüye kullanım koruması yok.** Otel anahtarı herkese açık olduğundan müsaitlik ucu taranabilir; rate limit ve bot koruması eklenmeli.
- **Otel çözümlemesi cache'lenmiyor.** Her istekte indeksli bir sorgu; ölçekte kısa TTL'li bellek cache'i eklenir.
- **`allowed_origins` için yönetim arayüzü yok;** seed/SQL ile yönetiliyor. Anahtar rotasyonu yok.
- **Ufuk yenileme süreç içi zamanlayıcı.** Çok replika'da idempotent ama gereksiz tekrar yapar; üretimde zamanlanmış bir iş olmalı.
- **PostgreSQL Row-Level Security yok** (bkz. ADR-0004); izolasyon şu an uygulama sorguları + bileşik FK ile sağlanıyor.
- **Sunucu tarafı `Origin` reddi,** sahte `Origin` gönderebilen sunucu-sunucu istemcilerini durdurmaz (CORS yetkilendirme değildir).
- **`package-lock.json` repoda yok.** İlk `npm install` sonrası commit'lenmeli; o zamana kadar Docker build'i `npm install` kullanır (`npm ci` değil).

## Repo yapısı

```
.
├── docker-compose.yml              # postgres → bootstrap → reservation (+ test profili)
├── docs/
│   ├── adr/                        # mimari karar kayıtları
│   └── api/openapi.yaml
└── services/reservation/
    ├── Dockerfile                  # deps → build → (test) → runtime (non-root, healthcheck)
    ├── migrations/001_init.sql
    ├── src/
    │   ├── app.ts                  # composition root
    │   ├── main.ts · config.ts · cli/bootstrap.ts
    │   ├── shared/                 # LocalDate, Clock, DomainError (framework'süz)
    │   ├── platform/               # db (pool, migrator, seed), http (hata eşleme)
    │   └── modules/
    │       ├── tenancy/            # domain · application · infra · http
    │       └── inventory/          # domain · application · infra · http
    └── test/
        ├── unit/ · integration/ · support/
```
