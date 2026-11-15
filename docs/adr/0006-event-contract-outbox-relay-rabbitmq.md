# ADR-0006: Olay sözleşmesi, outbox relay ve RabbitMQ

- **Durum:** Kabul edildi, uygulandı ve test edildi (`OutboxRelay`, `AmqpEventPublisher`, `src/cli/relay.ts`).
- **İlgili maddeler:** M10, M13

## Bağlam

CRM ve PMS rezervasyondan haberdar olmalı, ama rezervasyon servisi onları **çağırmamalı** (ADR-0001): CRM çökse de rezervasyon alınmaya devam etmeli. Aynı zamanda "rezervasyon kaydedildi ama olay kayboldu" (veya tersi: olay gitti, rezervasyon geri alındı) durumu olmamalı. Veritabanı ile broker arasında dağıtık transaction yoktur.

## Karar

### 1. Transactional outbox
Olay, rezervasyonla **aynı transaction'da** `outbox_events` tablosuna yazılır (ADR-0005'teki akışın 4. adımı). "Rezervasyon var" ile "olay yayınlanacak" birbirinden ayrılamaz.

### 2. Ayrı bir relay süreci
`reservation-relay` (aynı imaj, farklı komut), `published_at IS NULL` satırları `seq` sırasıyla okur, RabbitMQ'ya yayınlar, **broker onayından (publisher confirm) sonra** `published_at` yazar. Sonuç: **en az bir kez (at-least-once)** teslim; yayın ile işaretleme arasında çökme olayı **tekrarlatır, kaybettirmez**.

- **Tek aktif relay:** `pg_try_advisory_xact_lock` ile. Birden fazla kopya çalışsa bile yalnızca biri yayınlar; yayın sırası (`seq`) korunur. Sahibi ölürse kilit bağlantıyla birlikte düşer, diğeri devralır.
- **İlk hatada dur:** bir yayın başarısız olursa o satır ve sonrakiler beklemede kalır; bir rezervasyonun sonraki olayı öncekinden önce gitmez. Başarılı olanlar işaretlenir (kısmi ilerleme kaybolmaz).
- **Yayın `mandatory`:** hiçbir kuyruğa yönlendirilemeyen olay (ilk kurulumda tüketici kuyruğu henüz yokken) "yayınlandı" sayılmaz, outbox'ta bekler. Ayrıca Compose'ta relay, tüketiciler (`crm`, `pms-notifier`) sağlıklı olduktan sonra başlar.
- Broker kesilirse relay üstel beklemeyle yeniden bağlanır; olaylar outbox'ta birikir, kaybolmaz.
- Yoklama (polling, 500 ms; dolu batch'te beklemeden devam). Gecikme ≤ ~0,5 sn.

### 3. Olay sözleşmesi (zarf)
Servisler arasındaki **tek** bağ budur (`docs/api/events.md`). Zarf: `eventId` (outbox satır kimliği = tüketici tekilleştirme anahtarı), `type`, `occurredAt`, `hotelId`, `aggregateId`, `version`, `data`. `data` rezervasyonun **tam anlık görüntüsüdür** (fark değil): otel (`id`, `key`, `name`), oda tipi (`id`, `code`, `name`), tarihler, fiyat, misafir ve rıza zaman damgaları, `version`. Tam görüntü sayesinde tüketici yalnızca en yüksek `version`'ı tutarak sıra bozulmasında bile doğru duruma ulaşır; otel ve oda tipi adı olayda geldiği için CRM rezervasyon servisini hiç çağırmaz.

**Tolerant reader:** tüketici bilmediği alanları yok sayar; üretici alan ekleyebilir. Sözleşmeyi bozan mesaj "zehirli" (poison) sayılıp ölü mektup kuyruğuna gider (ADR-0008). Bilmediği `type`'ı tüketici sessizce atlar.

### 4. Broker: RabbitMQ
Topic exchange `rota.events`, yönlendirme anahtarı `type`. Her tüketici **kendi** kuyruğunu bağlar (`crm.reservation-events`, `pms.reservation-events`, `mail.reservation-events`); biri yavaşlasa ya da çökse diğerleri etkilenmez, olaylar kendi kuyruğunda bekler. Mesajlar kalıcı (persistent), kuyruklar dayanıklı (durable).

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| Rezervasyon servisi CRM'i HTTP ile çağırır | Case "yalnızca olaylardan beslenir" diyor; CRM çökünce rezervasyon etkilenir ya da olay kaybolur. |
| Transaction sonrası doğrudan broker'a yayın (outbox yok) | Commit ile yayın arasındaki çökme olayı sessizce kaybettirir (dual write). |
| Kafka | Bu ölçek için gereksiz operasyon yükü; ihtiyacımız olan sıralı, kalıcı, birden çok bağımsız tüketicili kuyruk RabbitMQ'da var. Tekrar oynatma (replay) gerektiren analitik gelirse Kafka yeniden değerlendirilir. |
| Redis Streams | Olur, ama ölü mektup/TTL tabanlı gecikmeli yeniden deneme RabbitMQ'da hazır; Redis'i yalnızca bunun için eklemek gereksiz. |
| Postgres `LISTEN/NOTIFY` ile gecikmeyi azaltma | Gecikme 0,5 sn'nin altına inmek için gerekmiyor; yoklama daha basit ve kayıpsız. Gerekirse yoklamanın üstüne eklenebilir. |
| Debezium (CDC) ile outbox okuma | Doğru ama bu ölçek için ağır altyapı; ayrı relay ~100 satır. |

## Sonuçlar

- (+) Rezervasyon ile olay atomik; broker kesintisinde rezervasyon alınmaya devam eder.
- (+) Tüketici sayısı artınca (yeni kuyruk) üretici değişmez.
- (−) At-least-once: **tüketiciler idempotent olmak zorunda** (ADR-0007, ADR-0008). Tekrar sıralamayı bozabilir; `version` bunu çözer.
- (−) Tek aktif relay, yayın verimini tek süreçle sınırlar (yüzlerce olay/sn'ye yeter). Daha fazlası için otel/aggregate bazlı bölümleme gerekir.
- (−) Outbox tablosu büyür; **bilinen eksik:** yayınlanmış satırların temizlenmesi (ör. 7 gün sonra silme) yok.
- **Doğrulama:** `test/integration/outbox-relay.test.ts` (ilk hatada durma, kayıpsız devam, tek relay, tam batch, zarf), `amqp-publisher.test.ts` (kalıcı mesaj, mesaj kimliği, yönlendirilemeyen olay reddi) ve Docker Compose ile uçtan uca (rezervasyon → CRM + PMS).
