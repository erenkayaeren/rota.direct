# ADR-0001: Modül sınırları ve olay tabanlı CRM

- **Durum:** Kabul edildi ve uygulandı. Ayrıntılar: [ADR-0006](0006-event-contract-outbox-relay-rabbitmq.md), [0007](0007-crm-projection-and-guest-matching.md), [0008](0008-consumer-retry-dead-letter-and-pms.md).
- **İlgili maddeler:** M9, M10, M11, M13

## Bağlam

Case, Rezervasyon, Envanter ve Misafir (CRM) sınırlarının kodda net görünmesini ve CRM'in rezervasyon verisini **yalnızca olaylardan** almasını (Rezervasyon servisi CRM'i doğrudan çağırmaz) istiyor. Aynı zamanda envanteri düşürmek ile rezervasyonu yazmak **tek transaction'da** olmak zorunda (M6, bkz. ADR-0002).

## Karar

İki dağıtılabilir servis ve bir taklit PMS:

| Birim | Sorumluluk | Veri |
|---|---|---|
| `reservation-service` | Tenancy + Envanter + Rezervasyon modülleri (modüler monolit) | `reservation` veritabanı |
| `crm-service` | Misafir profili, eşleştirme, not/etiket; yalnızca olay tüketir | kendi veritabanı |
| `pms-mock` | Sahte dış PMS (hata enjeksiyonlu) ve onu çağıran bildirim işçisi (PMS + e-posta günlüğü) | yok (bellekte) |

`reservation-service` içinde her modül aynı katmanlara sahiptir: `domain/` (saf kural), `application/` (use case + port arayüzleri), `infra/` (Postgres adaptörleri), `http/` (Fastify). Bağımlılık yönü tek yönlüdür: `reservation → inventory → tenancy`. Bu kurallar `test/unit/architecture.test.ts` ile **test olarak** korunur (domain framework/driver import edemez, tenancy inventory'ye bağımlı olamaz vb.).

CRM'e giden yol: rezervasyon transaction'ı ile aynı transaction'da `outbox` tablosuna olay yazılır, ayrı bir relay süreci RabbitMQ'ya yayınlar (ADR-0006). Servislerin ortak kod tabanı yoktur: aralarındaki tek sözleşme olay şemasıdır (`docs/api/events.md`).

## Alternatifler

- **Tek monolit (CRM aynı process'te):** Daha basit, ama "olaylardan beslenir" kuralını kod disiplinine bırakır; sınır ihlali kolaylaşır ve M10'daki asenkron akışı göstermenin anlamı kalmaz.
- **Tam mikroservis (Envanter ayrı servis):** Rezervasyon ile envanter düşümü ağ sınırının iki yanında kalır; M6'daki atomiklik için saga/telafi mantığı gerekir. İki pilot otel için ölçek gerekçesi yok, karmaşıklık maliyeti yüksek.

## Sonuçlar

- (+) Envanter + rezervasyon tek DB transaction'ında atomik; overbooking kanıtı basit.
- (+) CRM bağımsız çalışır, çökse bile rezervasyon akışı etkilenmez (olaylar kuyrukta bekler).
- (−) İki veritabanı/şema, olay şeması ve tekrar işleme (idempotent consumer) yönetimi gerekir.
- (−) Modül sınırları disiplin ister; bu yüzden architecture testi var.
- (−) Servisler bağımsız paketler olduğundan küçük altyapı kodu (havuz, migrator, tüketici) kopyalanmıştır. Kasıtlı bir takas: ortak bir paket, Docker bağlamlarını ve sürümlemeyi karmaşıklaştırırdı; kopyalar aynı testlerle korunur.
