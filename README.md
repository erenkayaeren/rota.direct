
Ürün ilk olarak iki pilot otelde çalışacağı için sistem baştan **çok kiracılı (multi-tenant)** tasarlandı; her otel bir kiracıdır.

> Widget, rezervasyon çekirdeği (overbooking'e karşı güvenli, idempotent), olay tabanlı CRM + paneli, PMS entegrasyonu (retry + dead-letter), e-posta günlüğü, müsaitlik cache'i ve tek komutla Docker kurulumu çalışıyor. Neyin tamam, neyin bilinçli eksik olduğu için [Kapsam durumu](#kapsam-durumu) ve [Bilinen eksikler](#bilinen-eksikler).

## İçindekiler

- [Rota Direct](#rota-direct)
  - [İçindekiler](#i̇çindekiler)
  - [Tek komutla kurulum](#tek-komutla-kurulum)
  - [Demoyu deneyin](#demoyu-deneyin)
  - [Kapsam durumu](#kapsam-durumu)
  - [Mimari](#mimari)
    - [Case diyagramıyla karşılaştırma](#case-diyagramıyla-karşılaştırma)
  - [Teknoloji seçimleri ve gerekçeleri](#teknoloji-seçimleri-ve-gerekçeleri)
  - [Önemli tasarım kararları](#önemli-tasarım-kararları)
  - [Varsayımlar](#varsayımlar)
  - [API ve olay sözleşmesi](#api-ve-olay-sözleşmesi)
  - [Test](#test)
  - [Bilinen eksikler](#bilinen-eksikler)
  - [Repo yapısı](#repo-yapısı)

## Tek komutla kurulum

Gereken tek şey Docker (Compose v2). Yerel Node/Postgres kurulumu gerekmez.

```bash
docker compose up --build
```

Bağımlılık sırası (Compose `depends_on` + health check ile): `postgres` / `crm-postgres` / `rabbitmq` (healthy) → `reservation-bootstrap` ve `crm-bootstrap` (migration + demo veri, bitince çıkar) → `reservation`, `crm`, `pms-mock` → `pms-notifier` → `reservation-relay` (en son: tüketici kuyrukları hazır olmadan olay yayınlanmasın diye) → `widget`.

| Servis | Adres | Ne |
|---|---|---|
| Demo otel siteleri + `widget.js` | http://localhost:8080 | Widget'ı tek satırla gömen örnek siteler |
| Rezervasyon API'si | http://localhost:3000 | Müsaitlik, rezervasyon, iptal |
| CRM paneli + API | http://localhost:3100 | Personel paneli (misafir arama, profil, not, etiket) |
| Sahte PMS | http://localhost:3200 | Dış sistem taklidi (`/api/v1/reservations`, `/admin/stats`) |
| RabbitMQ yönetim arayüzü | http://localhost:15672 | kullanıcı `rota` / parola `rota_dev_password` |

Durdurmak için `docker compose down` (veriyi de silmek için `-v`).

Ayarlar `.env` veya ortam değişkenleriyle değişir; hepsinin varsayılanı vardır: `POSTGRES_*`, `CRM_POSTGRES_*`, `RABBITMQ_*`, `PMS_API_KEY`, `PMS_FAILURE_MODE` (`ok`\|`down`\|`flaky`), `PMS_RETRY_DELAYS_MS` (yeniden deneme aralıkları, ör. `500,500` ile ölü mektup hemen görülür), `*_PORT`. Rezervasyon servisinde `AVAILABILITY_CACHE_TTL_MS` (varsayılan 10000, `0` = kapalı).

## Demoyu deneyin

**1. Widget:** http://localhost:8080 → Lagos veya Peri sitesi. Tarih seçin → oda seçin → bilgileri girin (KVKK onayı zorunlu) → onay ekranında rezervasyon kodunu görün. Aynı ekrandan iptal edebilirsiniz. Gömme kodunun tamamı:

```html
<script src="http://localhost:8080/widget.js" data-hotel-key="pk_lagos_beach_demo"
        data-api-base="http://localhost:3000"></script>
```

İsteğe bağlı öznitelikler: `data-lang` (`tr`\|`en`\|`auto`), `data-accent` (`#rrggbb` marka rengi), `data-kvkk-url` (otelin aydınlatma metni), `data-target` (widget'ın yerleşeceği öğenin CSS seçicisi). `/hostile.html` sayfası, her şeye `!important` uygulayan düşman bir CSS ile widget'ın bozulmadığını (ve sayfanın widget'tan etkilenmediğini) gösterir.

**2. CRM paneli:** http://localhost:3100 → demo personel anahtarı ile giriş. Widget'tan az önce yaptığınız rezervasyon birkaç saniye içinde misafir olarak görünür.

| Otel | Personel anahtarı (**yalnızca demo**, `SEED_DEMO_DATA=true` ile yüklenir) |
|---|---|
| Lagos Beach Hotel | `demo-lagos-staff-token-0001` |
| Peri Stone Cave Hotel | `demo-peri-staff-token-0002` |

**3. PMS kesintisi (retry + dead-letter):**

```bash
curl -XPOST localhost:3200/admin/failure-mode -H 'content-type: application/json' -d '{"mode":"down"}'
# widget'tan rezervasyon yapın: CRM anında güncellenir, PMS çağrıları 2 sn, 10 sn, 30 sn… aralıkla yeniden denenir
docker compose logs -f pms-notifier
curl -XPOST localhost:3200/admin/failure-mode -H 'content-type: application/json' -d '{"mode":"ok"}'
curl localhost:3200/admin/stats        # olay kaybolmadan PMS'e ulaştı
```

Tüm denemeler tükenirse mesaj `pms.reservation-events.dead` kuyruğuna düşer (RabbitMQ arayüzünde görünür); neden giderilince `docker compose run --rm pms-notifier node dist/cli/replay-dead.js` onları geri oynatır. Onay e-postaları `docker compose logs pms-notifier` çıktısında `"email (simulated)"` satırları olarak görünür.

**4. API'yi doğrudan çağırma** (macOS için `date -v+7d +%F`, Linux için `date -d '+7 days' +%F`; tarihler bugünden sonra olmalı):

```bash
CHECK_IN=$(date -v+7d +%F); CHECK_OUT=$(date -v+10d +%F)
curl -s "http://localhost:3000/v1/public/pk_lagos_beach_demo/availability?checkIn=$CHECK_IN&checkOut=$CHECK_OUT&adults=2&children=0"
```

Demo otel anahtarları (herkese açık anahtarlardır, gizli değildir):

| Otel | `data-hotel-key` | İzinli origin'ler |
|---|---|---|
| Lagos Beach Hotel (Antalya) | `pk_lagos_beach_demo` | `https://www.lagosbeachhotel.example`, `http://localhost:8080` |
| Peri Stone Cave Hotel (Kapadokya) | `pk_peri_stone_demo` | `https://www.peristonecave.example`, `http://localhost:8080` |

`http://localhost:8080` geliştirme sırasındaki demo host sayfası içindir; gerçek bir otelde kaldırılmalıdır.

## Kapsam durumu

| Madde | Durum | Not |
|---|---|---|
| M1 Tek satırla gömülen widget | ✅ | Preact, tek dosya `widget.js`, `<script data-hotel-key>`; [ADR-0003](docs/adr/0003-widget-isolation-shadow-dom.md) |
| M2 Arama doğrulaması | ✅ | Widget'ta anlık, sunucuda yetkili (geçmiş tarih, ters aralık, 30 gece, kapasite…) |
| M3 Sonuç listesi | ✅ | Oda tipi, gecelik ve toplam fiyat, kalan oda ("Son 2 oda!") |
| M4 Rezervasyon formu + onay | ✅ | KVKK zorunlu, pazarlama izni ayrı ve işaretsiz; onay ekranında kod ve iptal |
| M5 Müsaitlik API'si | ✅ | Gece bazında, oda tipi bazında; check-out gecesi hariç |
| M6 Rezervasyon (overbooking'siz) | ✅ | Koşullu atomik `UPDATE`, tek transaction, gerçek eşzamanlı isteklerle kanıtlı ([ADR-0002](docs/adr/0002-overbooking-prevention.md)) |
| M7 Idempotency | ✅ | `Idempotency-Key` + aynı transaction'da talep; widget aynı niyette aynı anahtarı yeniden kullanır ([ADR-0005](docs/adr/0005-idempotent-reservations.md)) |
| M8 İptal + stok iadesi | ✅ | Kod + e-posta; çift iptal `409`, oda bir kez geri açılır |
| M9 Çok kiracılılık | ✅ | Tenant scope'u, per-otel CORS, sorgu + FK katmanlı izolasyon, CRM'de token'dan otel ([ADR-0004](docs/adr/0004-tenant-resolution-and-cors.md), [0010](docs/adr/0010-crm-staff-access-and-panel-security.md)) |
| M10 Olay tabanlı akış | ✅ | Outbox → relay → RabbitMQ → CRM; at-least-once, idempotent tüketici ([ADR-0006](docs/adr/0006-event-contract-outbox-relay-rabbitmq.md)) |
| M11 Misafir profili ve eşleştirme | ✅ | E-posta ile eşleşme, sırasız olaylara dayanıklı ([ADR-0007](docs/adr/0007-crm-projection-and-guest-matching.md)) |
| M12 CRM paneli | ✅ | Arama, sayfalama, filtre, sıralama, profil, rezervasyon geçmişi, not, etiket |
| M13 Docker | ✅ | Tek komut; çok aşamalı imajlar, non-root, health check, bağımlılık sırası, test profili |
| S1 Durum makinesi | ✅ | `PENDING → CONFIRMED → CHECKED_IN → CHECKED_OUT`, `CANCELLED`, `NO_SHOW`; geçişler veri olarak tanımlı. Personel geçiş **uçları** yok (bkz. eksikler) |
| S2 PMS entegrasyonu | ✅ | Sahte PMS + bildirim işçisi; gecikmeli yeniden deneme + ölü mektup + replay aracı ([ADR-0008](docs/adr/0008-consumer-retry-dead-letter-and-pms.md)) |
| S3 TR/EN | ✅ | Widget'ta iki dil, hata kodları yerelleştirilmiş (eksik çeviri testle yakalanır) |
| S4 Stil izolasyonu | ✅ | Shadow DOM; gerçek Chrome'da düşman CSS ile doğrulandı |
| S5 Docker cilası | ✅ | Her servis için ayrı imaj, health check, `docker compose --profile test` |
| S6 Cache | ✅ | Kısa TTL + otel bazlı invalidasyon + single flight; rezervasyon cache'e bakmaz ([ADR-0009](docs/adr/0009-availability-cache.md)) |
| B5 Bundle boyutu | ✅ | `widget.js` **45,6 kB, 16,5 kB gzip** (Preact dahil) |
| B4 Gözlemlenebilirlik | 🟡 | Yapılandırılmış JSON log, `x-request-id`, health uçları; dağıtık trace/metrik yok |
| B1 B2 B3 B6 | ⏭️ Bilinçli atlandı | Segmentler, huni olayları, fiyat kuralları, dağıtım yapılandırması |

## Mimari

```
   Otel sitesi
   <script src=".../widget.js" data-hotel-key="...">  ── Shadow DOM, TR/EN ──┐
                                                                            │ HTTPS (per-otel CORS)
                                                                            ▼
┌──────────────────── reservation-service (modüler monolit) ────────────────────┐
│  http ─► application ─► domain ◄── infra (Postgres)                            │
│  tenancy ◄── inventory ◄── reservation                                         │
│  (otel, CORS)  (müsaitlik+cache)  (rezervasyon, idempotency, outbox)           │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │ aynı transaction'da outbox satırı
              ▼
      reservation-relay ──(publisher confirm, tek aktif, sıralı)──► RabbitMQ  topic exchange "rota.events"
                                                                      │ reservation.created / .cancelled
                      ┌───────────────────────────────┬───────────────┴────────────┐
                      ▼                               ▼                            ▼
        crm.reservation-events        pms.reservation-events         mail.reservation-events
        crm-service (kendi DB'si)     pms-notifier ──HTTP──► pms-mock   pms-notifier (e-posta günlüğü)
        misafir profili + panel       retry → dead-letter               retry → dead-letter
```

- Servisler arasındaki **tek bağ olay sözleşmesidir** ([`docs/api/events.md`](docs/api/events.md)). CRM rezervasyon veritabanını okumaz, rezervasyon servisi CRM'i çağırmaz; CRM çökse rezervasyon alınmaya devam eder, olaylar kuyrukta bekler.
- Her tüketicinin **kendi kuyruğu** vardır: PMS çökükken CRM ve e-posta akmaya devam eder.
- Gerekçe: [ADR-0001](docs/adr/0001-module-boundaries-and-event-driven-crm.md), [ADR-0006](docs/adr/0006-event-contract-outbox-relay-rabbitmq.md).

### Case diyagramıyla karşılaştırma

Case'in sistem bağlamı diyagramındaki 6 bileşenin hepsi vardır: widget, rezervasyon servisi, PMS (mock), asenkron olay akışı, CRM servisi, CRM paneli. Bağlantılar da diyagramdakilerdir (widget→API, olay yayını, olay→CRM tüketimi, panel→CRM API'si, PMS bildirimi). **Tek fark PMS okunun yolu:**

| | Diyagram | Bu proje |
|---|---|---|
| PMS bildirimi | Rezervasyon servisinden PMS'e ayrı, doğrudan bir ok | Rezervasyon servisi PMS'i çağırmaz; bildirim, CRM'i de besleyen **aynı olay akışından** geçer ve `pms-notifier` işçisi PMS'e iletir |

```
Diyagram :  Rezervasyon servisi ──bildirim──► PMS
Bu proje :  Rezervasyon servisi ──(outbox)──► olay akışı ──► pms-notifier ──► PMS
```

Neden: diyagramdaki "hata durumunda kayıpsız" şartını, doğrudan HTTP çağrısıyla sağlamak için sonunda yine bir kuyruk ve yeniden deneme gerekir. Bunu ayrı bir mekanizma olarak icat etmek yerine mevcut olay altyapısına koyduk:
- PMS çökse de rezervasyon alınmaya devam eder (rezervasyon servisi PMS'i bilmez).
- Bildirim, rezervasyonla **aynı transaction'da** outbox'a yazıldığı için "rezervasyon var ama bildirim kayboldu" durumu olamaz.
- Yeniden deneme, ölü mektup kuyruğu ve `replay-dead` aracı hazırdır; her tüketici (CRM, PMS, e-posta) kendi kuyruğunda bağımsızdır.

Diyagramın kendisi "teknoloji ve servis sınırları adaya aittir" der; bu, o serbestlik içinde yapılmış bilinçli bir seçimdir. Gerekçe: [ADR-0001](docs/adr/0001-module-boundaries-and-event-driven-crm.md), [ADR-0006](docs/adr/0006-event-contract-outbox-relay-rabbitmq.md), [ADR-0008](docs/adr/0008-consumer-retry-dead-letter-and-pms.md).

**Katmanlar (reservation ve CRM servislerinde her modülde aynı):**

| Katman | İçerik | İzinli bağımlılık |
|---|---|---|
| `domain/` | Saf iş kuralı (tarih kuralları, müsaitlik hesabı, durum makinesi, eşleştirme kuralları) | Yalnızca `shared/` |
| `application/` | Use case'ler ve port arayüzleri | `domain/`, `shared/` |
| `infra/` | Port'ların Postgres/RabbitMQ adaptörleri | `application/`, `domain/` |
| `http/` | Fastify route'ları, giriş/çıkış dönüşümü | `application/`, `domain/` |

Bu kurallar yorum değil, **test**: `test/unit/architecture.test.ts` domain'in framework/driver import etmediğini, `tenancy`→`inventory`→`reservation` yönünün tek yönlü olduğunu, reservation modülünün diğerlerinin HTTP katmanına uzanmadığını doğrular. `app.ts` hangi port'u hangi adaptörün uyguladığını bilen tek yerdir (composition root).

## Teknoloji seçimleri ve gerekçeleri

| Konu | Seçim | Gerekçe | Alternatif |
|---|---|---|---|
| Dil | TypeScript (Node 22) | Domain modelini tiple ifade etmek (ör. `LocalDate`), widget ile aynı dil | Java/Spring, .NET |
| HTTP | Fastify 5 | Encapsulation + hook modeli tenant ve personel scope'una birebir oturuyor; küçük ve hızlı | NestJS (bu ölçek için fazla yapı/sihir), Express |
| Veritabanı | PostgreSQL 16, **servis başına ayrı** | Transaction, `CHECK`/bileşik FK, atomik `UPDATE`, advisory lock; overbooking'i ve olay tekilleştirmeyi veritabanında kanıtlayabilmek | MySQL, MongoDB (kısıt yok), Redis (envanter için dayanıksız) |
| DB erişimi | `pg` + elle SQL | Envanter ve projeksiyon mantığının özü SQL; ORM tam burada gizlerdi | Prisma, Drizzle, Knex |
| Migration | Kendi küçük runner'ım (checksum + advisory lock) | ~60 satır, uygulanmış migration'ın değiştirilmesini yakalar | node-pg-migrate, Flyway |
| Mesajlaşma | **RabbitMQ** + transactional outbox | Her tüketiciye ayrı kuyruk, TTL + ölü mektupla gecikmeli yeniden deneme hazır; bu ölçek için Kafka fazla ([ADR-0006](docs/adr/0006-event-contract-outbox-relay-rabbitmq.md)) | Kafka, Redis Streams, CDC |
| Doğrulama | zod | Çalışma zamanı şeması; format hataları (400) ile iş kuralları (422) ayrı; olay sözleşmesi için tolerant reader | ajv |
| Widget | **Preact + Vite + Shadow DOM** | 16,5 kB gzip, garanti edilmiş stil izolasyonu ([ADR-0003](docs/adr/0003-widget-isolation-shadow-dom.md)) | React, iframe |
| CRM paneli | Bağımlılıksız ES modülleri | Derleme hattı yok; kullanıcı verisi yalnızca `textContent` ile basılır, sıkı CSP ([ADR-0010](docs/adr/0010-crm-staff-access-and-panel-security.md)) | React/Vue SPA |
| Test | Vitest (+ jsdom, gerçek Postgres ve RabbitMQ) | TypeScript'i doğrudan çalıştırır; veritabanı ve broker davranışı taklit değil gerçek | Jest |
| Konteyner | Çok aşamalı Dockerfile, `node:22-alpine`, non-root; widget için unprivileged nginx | Küçük, saldırı yüzeyi dar imaj; `test` hedefi aynı Dockerfile'dan | Tek aşamalı imaj |

## Önemli tasarım kararları

Büyük kararların tam gerekçesi ADR'lerde:

| ADR | Konu |
|---|---|
| [0001](docs/adr/0001-module-boundaries-and-event-driven-crm.md) | Modül ve servis sınırları, "CRM yalnızca olaylardan beslenir" |
| [0002](docs/adr/0002-overbooking-prevention.md) | Overbooking önleme: koşullu atomik `UPDATE` + `CHECK` |
| [0003](docs/adr/0003-widget-isolation-shadow-dom.md) | Widget izolasyonu: Shadow DOM |
| [0004](docs/adr/0004-tenant-resolution-and-cors.md) | Tenant çözümü ve per-otel CORS |
| [0005](docs/adr/0005-idempotent-reservations.md) | Idempotent rezervasyon: anahtarı aynı transaction'da talep etmek |
| [0006](docs/adr/0006-event-contract-outbox-relay-rabbitmq.md) | Olay sözleşmesi, outbox relay, RabbitMQ |
| [0007](docs/adr/0007-crm-projection-and-guest-matching.md) | CRM projeksiyonu, misafir eşleştirme, idempotent tüketici |
| [0008](docs/adr/0008-consumer-retry-dead-letter-and-pms.md) | Yeniden deneme, ölü mektup, PMS entegrasyonu |
| [0009](docs/adr/0009-availability-cache.md) | Müsaitlik cache'i |
| [0010](docs/adr/0010-crm-staff-access-and-panel-security.md) | CRM personel erişimi ve panel güvenliği |

Kısa liste:

- **Envanter, gece başına satır.** `inventory(hotel_id, room_type_id, stay_date, total, booked)`. Müsaitlik "her gecede en az bir oda boş mu" sorusu olur ve rezervasyon bu satırları tek `UPDATE` ile düşer. `total` satırda tutulur: tek bir gece için stop-sell/bakım, diğer tarihlere dokunmadan yapılabilir.
- **Envanter ufku.** Satırlar bugünden 400 gün ileriye kadar önceden oluşturulur (`ensureInventoryHorizon`); rezervasyon penceresi 365 gün. Bootstrap'ta ve serviste 6 saatte bir çalışır; idempotenttir. Satırı olmayan bir gece "satışta değil" sayılır.
- **Check-out günü gece değildir.** Misafir o sabah ayrılır; `[checkIn, checkOut)` aralığı.
- **Tarih = saat dilimsiz takvim günü.** Tarihler uçtan uca `YYYY-MM-DD` string'idir (HTTP → domain → Postgres `DATE`), hiçbir yerde JS `Date` değil. "Bugün", sunucunun değil **otelin** saat dilimindedir (`Europe/Istanbul`): UTC 22:30'da Antalya'da saat 01:30 ve ertesi gündür (unit testle doğrulanıyor).
- **Para = tam sayı kuruş.** `320000` = 3.200 TRY; kayan nokta yok, bölme yalnızca gösterimde.
- **Hata modeli.** Tek JSON şekli `{ "error": { "code", "message", "details"? } }`. Biçim hataları `400 INVALID_REQUEST`, iş kuralı ihlalleri `422` + kararlı `code`; widget TR/EN metni kod üzerinden seçer, mesajı ayrıştırmaz.
- **Overbooking: kontrol ve düşüş tek ifade.** `UPDATE inventory SET booked = booked + 1 … AND booked < total`; etkilenen satır sayısı gece sayısına eşit değilse tüm transaction geri alınır (`409 SOLD_OUT`). `CHECK (booked <= total)` son sigorta.
- **Rezervasyon doğrudan `CONFIRMED` doğar** (ödeme otelde). `PENDING` durum makinesinde var ama akış kullanmaz.
- **Misafir doğrulaması = rezervasyon kodu + e-posta.** Yanlış e-posta, bilinmeyen kod ve başka otelin kodu **aynı** `404`'ü döner; kod keşfi mümkün olmaz.
- **KVKK ve pazarlama izni ayrı** ve ikisi de zaman damgalı. Pazarlama kutusu hiçbir zaman önceden işaretli değildir; izin, misafirin **en son** rezervasyonundaki seçime göre CRM'de güncellenir (eski bir iptalin olayı geri çekilmiş izni ezmez). PMS'e pazarlama izni gönderilmez.
- **Olaylar tam anlık görüntü taşır** ve `version` içerir; sıra bozulsa, tekrar gelse bile en yüksek `version` doğru duruma götürür.
- **Başarısız deneme iz bırakmaz.** `SOLD_OUT` gibi bir hatada transaction ile birlikte `Idempotency-Key` de geri alınır; oda boşalınca aynı anahtarla yeniden denenebilir.
- **Misafir eşleştirme muhafazakâr.** Yalnızca (otel, normalize e-posta); telefon yalnızca "olası kopya" ipucu. Yanlış birleştirmek, kopya bırakmaktan pahalıdır.

## Varsayımlar

Case metninin açıkça söylemediği yerlerde alınan kararlar:

- **Maksimum kişi = yetişkin + çocuk.** Çocuk yaşı alınmıyor; çocuk da kapasiteye sayılır (muhafazakâr).
- Yalnızca partiye **sığan** ve tüm gecelerinde **boş** oda tipleri döner; dolu tipler listelenmez. Hiçbir oda tipi partiyi barındıramıyorsa `422 CAPACITY_EXCEEDED`.
- En az 1 yetişkin; en fazla 10 yetişkin ve 10 çocuk. En fazla **30 gece**. Konaklama bugünden itibaren **365 gün** içinde bitmeli.
- Fiyat, oda tipinin sabit gecelik fiyatıdır (hafta sonu farkı gibi kurallar B3 kapsamı). Para birimi otelin para birimidir (TRY).
- Ödeme yok: "ödeme otelde". **E-posta gönderimi log'a yazılır** (`MailSender` arayüzü; gerçek sağlayıcı takılabilir). Olayda dil tercihi olmadığından e-posta TR+EN'dir.
- **Telefon E.164'e normalize edilir.** Türkiye biçimleri kabul edilir (`0532 123 45 67`, `532…`, `0090…`, `+90…` → `+905321234567`); yurt dışı numaralar `+` ile verilmeli. E-posta küçük harfe çevrilir.
- **İptal politikası yok:** ücret/süre sınırı uygulanmaz; durum makinesinin izin verdiği her `PENDING`/`CONFIRMED` rezervasyon iptal edilebilir.
- **Her otel ayrı veri sorumlusudur:** aynı kişi iki otelde iki ayrı CRM profilidir.
- **Personel tek rolde:** otel personeli o otelin tüm misafirlerini görür ve not/etiket ekleyebilir; rol ayrımı yok.

## API ve olay sözleşmesi

- Rezervasyon API'si: [`docs/api/openapi.yaml`](docs/api/openapi.yaml) · CRM API'si: [`docs/api/crm.openapi.yaml`](docs/api/crm.openapi.yaml) · Olaylar: [`docs/api/events.md`](docs/api/events.md)

| Uç | Açıklama |
|---|---|
| `GET /v1/public/{hotelKey}/availability?checkIn&checkOut&adults&children` | Müsaitlik (M5). `X-Cache: HIT\|MISS\|OFF`, tarayıcıya `no-store` |
| `POST /v1/public/{hotelKey}/reservations` | Rezervasyon oluştur (M6). `Idempotency-Key` başlığı zorunlu (M7) |
| `POST /v1/public/{hotelKey}/reservations/{code}/cancel` | Gövde `{ "email" }`; iptal + stok iadesi (M8) |
| `OPTIONS /v1/public/{hotelKey}/*` | Per-otel CORS preflight |
| `GET /health/live`, `GET /health/ready` | Süreç ve veritabanı sağlığı |
| CRM: `GET /api/v1/guests`, `GET /api/v1/guests/{id}`, `POST …/notes`, `PUT …/tags` | Personel (bearer token) |

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

Rezervasyon örneği:

```bash
curl -s -X POST localhost:3000/v1/public/pk_lagos_beach_demo/reservations \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
  -d '{"roomTypeId":"<availability yanıtındaki id>","checkIn":"2026-11-10","checkOut":"2026-11-13","adults":2,"children":0,
       "guest":{"firstName":"Ayşe","lastName":"Yılmaz","email":"ayse@example.com","phone":"0532 123 45 67"},
       "consents":{"kvkk":true,"marketing":false}}'
```

Hata kodları: `400 INVALID_REQUEST` (biçim, eksik `Idempotency-Key`) · `404 ROOM_TYPE_NOT_FOUND` · `404 RESERVATION_NOT_FOUND` · `409 SOLD_OUT` · `409 INVALID_STATE_TRANSITION` · `422` (`KVKK_CONSENT_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`, `CAPACITY_EXCEEDED`, `INVALID_EMAIL`, `INVALID_PHONE`, `INVALID_GUEST_NAME`, `CHECK_IN_IN_PAST`, `INVALID_DATE_RANGE`, `STAY_TOO_LONG`, `OUTSIDE_BOOKING_WINDOW`, `INVALID_GUEST_COUNT`). CRM: `401 UNAUTHENTICATED`, `404 GUEST_NOT_FOUND`, `422 INVALID_TAG | TOO_MANY_TAGS | INVALID_NOTE`.

## Test

Dört paket, hepsi Docker içinde çalıştırılabilir. Entegrasyon testleri **gerçek Postgres ve RabbitMQ** kullanır; taklit yoktur.

| Paket | Test | Ne test eder |
|---|---|---|
| `services/reservation` | **186** | Tarih/kişi kuralları, müsaitlik hesabı, saat dilimi, CORS, hata eşleme, modül sınırları, durum makinesi, misafir/telefon normalizasyonu, KVKK, rezervasyon kodu, `CreateReservation` akışı (sahte transaction ile); API (müsaitlik, rezervasyon, hata kodları, tenant izolasyonu, CORS, idempotency sıralı + eşzamanlı, iptal, outbox); **M6 eşzamanlılık**; veritabanı kısıtları ve migrator; **outbox relay** (ilk hatada durma, tek aktif relay); RabbitMQ yayıncısı; **cache** (TTL, invalidasyon, single flight, bayat cache'te SOLD_OUT) |
| `services/crm` | **82** | Olay sözleşmesi (tolerant reader, zehirli mesaj); **projeksiyon** (çift teslimat, 8 eş zamanlı aynı olay, sırasız iptal, eski rezervasyon rızayı ezmez, otel izolasyonu, geri alma); API (kimlik doğrulama, tenant izolasyonu, arama, sayfalama, sıralama, LIKE kaçışı, not, etiket); **gerçek RabbitMQ ile yeniden deneme / ölü mektup / zehirli mesaj**; panel güvenlik başlıkları ve yardımcıları |
| `services/pms-mock` | **24** | PMS olay dönüşümü (pazarlama izni gitmez), sahte PMS (idempotency, eski `version` reddi, hata enjeksiyonu), geçici/kalıcı hata ayrımı, e-posta içeriği, yeniden deneme yönlendirmesi |
| `widget` | **68** | Doğrulama, tarih/para, i18n (TR/EN yapı eşitliği, her sunucu hata kodu çevrili), API istemcisi, jsdom'da tüm akış (arama → oda → form → onay, SOLD_OUT dönüşü, aynı niyette aynı `Idempotency-Key`, iptal, dil, yapılandırma hataları, tek satır gömme), Shadow DOM yapısal izolasyonu |

```bash
docker compose --profile test run --build --rm reservation-test
docker compose --profile test run --build --rm crm-test
docker compose --profile test run --build --rm pms-test
docker compose --profile test run --build --rm widget-test
```



Yerelde: `cd services/reservation && npm install`, ardından `TEST_DATABASE_URL=postgres://rota:rota_dev_password@localhost:5432/postgres npm test` (kullanıcı `CREATE DATABASE` yapabilmeli; RabbitMQ testleri için `TEST_AMQP_URL=amqp://rota:rota_dev_password@localhost:5672`, yoksa atlanır). Her test dosyası kendi geçici veritabanını yaratıp siler; dosyalar paralel çalışır ve testler envanteri serbestçe değiştirebilir.

**Negatif kontrol (M6):** `AND booked < total` koşulu geçici olarak kaldırıldığında eşzamanlılık testlerinin 4'ünden 3'ü kırılıyor (veritabanındaki `CHECK` fazla satışı yine engelliyor, ama istemci `409` yerine `500` alıyor); yani testler gerçekten uygulama düzeyindeki korumayı ölçüyor.

## Bilinen eksikler

Bilerek bırakılanlar ve üretimde kapatılması gerekenler:

- **Hız sınırlama / kötüye kullanım koruması yok** (müsaitlik, rezervasyon, iptal, CRM giriş denemeleri). Otel anahtarı herkese açık olduğundan uçlar taranabilir.
- **CRM personel yönetimi yok:** token oluşturma/döndürme/iptal arayüzü, roller ve denetim kaydı (kim hangi misafire baktı) yok. Demo token'ları yayınlıdır; üretimde `SEED_DEMO_DATA` kapalı olmalı ([ADR-0010](docs/adr/0010-crm-staff-access-and-panel-security.md)).
- **KVKK silme/anonimleştirme akışı yok.** Misafir kişisel verisi olaylarda ve CRM'de kalır; silme talebi için olay + CRM tarafında işleme gerekir.
- **Misafir birleştirme aracı yok;** farklı e-postayla gelen aynı kişi iki profil olur, yalnızca "olası kopya" ipucu gösterilir ([ADR-0007](docs/adr/0007-crm-projection-and-guest-matching.md)).
- **Personel geçiş uçları yok** (check-in, check-out, no-show): durum makinesi hazır, uçlar ve personel yetkisi eklenmedi. CRM `CHECKED_IN` vb. olaylarını şimdilik "bilinmeyen tür" diye atlar.
- **Temizlik işleri yok:** `idempotency_keys`, yayınlanmış `outbox_events`, `processed_events` büyür (TTL ile silinmeli). Replay, doğrulamadan sonra olduğu için tarih arada geçmişe dönerse `422` döner ([ADR-0005](docs/adr/0005-idempotent-reservations.md)).
- **Tek aktif relay:** sıra korunur ama yayın verimi tek süreçle sınırlıdır; çok yüksek hacimde aggregate bazlı bölümleme gerekir ([ADR-0006](docs/adr/0006-event-contract-outbox-relay-rabbitmq.md)).
- **Cache süreç başına:** çok kopyada bir kopyanın rezervasyonu diğerinin cache'ini TTL'e (≤10 sn) kadar bayat bırakır; sonuç yanlış satış değil temiz `SOLD_OUT`'tur ([ADR-0009](docs/adr/0009-availability-cache.md)).
- **Ölü mektup için alarm yok;** yalnızca RabbitMQ arayüzü ve loglar. E-posta tekrar teslimatta tekrarlanabilir (gerçek sağlayıcıda `eventId` idempotency anahtarı olmalı). PMS için devre kesici yok ([ADR-0008](docs/adr/0008-consumer-retry-dead-letter-and-pms.md)).
- **Otel çözümlemesi cache'lenmiyor.** Her istekte indeksli bir sorgu; ölçekte kısa TTL'li bellek cache'i eklenir.
- **`allowed_origins` için yönetim arayüzü yok;** seed/SQL ile yönetiliyor. Anahtar rotasyonu yok.
- **PostgreSQL Row-Level Security yok** (bkz. ADR-0004); izolasyon uygulama sorguları + bileşik FK ile sağlanıyor.
- **Sunucu tarafı `Origin` reddi,** sahte `Origin` gönderebilen sunucu-sunucu istemcilerini durdurmaz (CORS yetkilendirme değildir).
- **Ufuk yenileme süreç içi zamanlayıcı.** Çok kopyada idempotent ama gereksiz tekrar yapar; üretimde zamanlanmış bir iş olmalı.
- **Widget:** `widget.js` adresi sürümlü değil (`no-cache` ile her yüklemede doğrulanır); üretimde `widget.<hash>.js` ve uzun cache gerekir. Sahte PMS durumu bellekte tutar, yeniden başlayınca unutur.
- **TLS yok:** yığın yerel geliştirme içindir; üretimde bir ters vekil (HTTPS) arkasında çalışmalı.
- **Panel yalnızca Türkçe;** erişilebilirlik denetimi yalnızca temel düzeyde (etiketler, odak, `aria-live`), otomatik a11y testi yok.

## Repo yapısı

```
.
├── docker-compose.yml              # tüm yığın + test profili
├── docs/
│   ├── adr/                        # 0001-0010 mimari karar kayıtları
│   └── api/                        # openapi.yaml (rezervasyon) · crm.openapi.yaml · events.md (olay sözleşmesi)
├── widget/                         # Preact + Vite → tek dosya widget.js; nginx ile demo otel siteleri
│   ├── src/                        # element.ts (Shadow DOM) · bootstrap.ts (script etiketi) · ui/ · i18n/ · api/ · domain/
│   ├── demo/                       # lagos.html · peri.html · hostile.html
│   └── test/
└── services/
    ├── reservation/                # modüler monolit: tenancy · inventory (+cache) · reservation
    │   ├── migrations/             # 001_init · 002_reservations (rezervasyon, idempotency, outbox)
    │   ├── src/cli/                # bootstrap.ts · relay.ts (outbox → RabbitMQ)
    │   └── test/                   # unit · integration · support
    ├── crm/                        # misafir CRM (kendi veritabanı)
    │   ├── migrations/             # 001_init (misafir, rezervasyon projeksiyonu, not, etiket, gelen kutusu, personel)
    │   ├── src/modules/            # guests (domain·application·infra·http) · access (token kimlik doğrulama)
    │   ├── src/platform/messaging/ # retrying-consumer.ts (yeniden deneme + ölü mektup)
    │   └── panel/                  # personel paneli (bağımlılıksız ES modülleri)
    └── pms-mock/                   # sahte PMS (server.ts) + bildirim işçisi (worker.ts: PMS + e-posta) + replay-dead
```

TypeScript (Node 22), Fastify 5, PostgreSQL 16 (pg ile elle SQL, ORM yok), kendi yazılmış küçük migration runner'ı, RabbitMQ, zod, Preact + Vite ve Vitest. Vitest testleri gerçek Postgres ve RabbitMQ'ya karşı çalışır.



Widget ─HTTP─► Reservation API ─(aynı tx'te outbox)─► Postgres
                                       │
                               reservation-relay
                                       ▼
                       RabbitMQ  topic exchange "rota.events"
              ┌──────────────┬──────────────┬──────────────┐
              ▼              ▼              ▼
        crm.* kuyruğu   pms.* kuyruğu   mail.* kuyruğu
        CRM servisi     pms-notifier    pms-notifier
        (profil+panel)  (→ pms-mock)    (e-posta günlüğü)



Öne çıkan teknik kararlar
Overbooking: tek transaction içinde koşullu atomik UPDATE. Gerçek eşzamanlı isteklerle test edildi (ADR-0002).
Idempotency: Idempotency-Key başlığı, aynı transaction'da talep edilir (ADR-0005).
Çok kiracılılık: public key ile otel çözümü, otel başına CORS. CRM'de otel, personel token'ından gelir (ADR-0004, ADR-0010).
Olay akışı: outbox, relay, RabbitMQ. Tüketici tarafında yeniden deneme ve ölü mektup kuyruğu var (ADR-0006, ADR-0008).
Müsaitlik cache'i: kısa TTL, otel bazlı invalidasyon ve single flight. Rezervasyon cache'e bakmaz (ADR-0009).
Misafir eşleştirme: e-posta ile eşleşir, sırasız gelen olaylara dayanıklıdır (ADR-0007).



Servis	Kullanıcı / parola
RabbitMQ arayüzü http://localhost:15672	rota / rota_dev_password
Postgres	rota / rota_dev_password (reservation DB'si: reservation)


Otel	Personel anahtarı
Lagos Beach Hotel	:  demo-lagos-staff-token-0001
Peri Stone Cave Hotel :  	demo-peri-staff-token-0002