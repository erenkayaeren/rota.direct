# ADR-0008: Tüketici yeniden deneme, ölü mektup kuyruğu ve PMS entegrasyonu

- **Durum:** Kabul edildi, uygulandı ve gerçek RabbitMQ ile test edildi (`RetryingConsumer`, `services/pms-mock`).
- **İlgili maddeler:** M10, S2

## Bağlam

PMS gibi dış sistemler yavaşlar, 503 verir, çöker. Bir PMS kesintisi rezervasyonu, CRM'i ya da e-postayı etkilememeli ve **hiçbir olay kaybolmamalı**. Öte yandan bozuk bir mesajı sonsuza dek yeniden denemek kuyruğu tıkar.

## Karar

### 1. Gecikmeli yeniden deneme, düz RabbitMQ kuyruklarıyla
Her tüketici kuyruğu `Q` için:
- `Q.retry.<N>ms` (TTL = N, süre dolunca varsayılan exchange üzerinden `Q`'ya geri döner) kuyrukları,
- `Q.dead` ölü mektup kuyruğu.

Başarısız mesaj, **onay (confirm) alınana kadar** retry kuyruğuna (ya da `Q.dead`'e) yeniden yayınlanır, **sonra** orijinali ack'lenir. Yeniden yayın başarısız olursa `nack(requeue)`: mesaj kaybolmaz. Çökme her adımda "tekrar teslimat" üretir, kayıp değil. Deneme sayısı `x-attempt` başlığında, hata nedeni `x-last-error`, ilk yönlendirme anahtarı `x-original-routing-key` başlıklarında taşınır.

Varsayılan bekleme (PMS): 2 sn, 10 sn, 30 sn, 1 dk, 5 dk, sonra `Q.dead`. CRM: 1 sn, 5 sn, 30 sn, 2 dk. (`CONSUMER_RETRY_DELAYS_MS`)

### 2. Hata sınıflandırması: geçici ve kalıcı
- **Geçici** (yeniden denenir): ağ hatası, zaman aşımı (3 sn), 5xx, 429/408, **401/403** (yanlış API anahtarı operatörün düzeltebileceği bir hatadır; düzelince ölü mektuplar tekrar oynatılır).
- **Kalıcı** (`PoisonMessageError`, yeniden denenmeden `Q.dead`): bozuk JSON, sözleşmeyi bozan olay, PMS'in 400/404/409/410/413/415/422 yanıtı ("bu istek yanlış").

### 3. Her tüketicinin kendi kuyruğu
`crm.`, `pms.`, `mail.reservation-events`. PMS çökükken CRM ve e-posta akmaya devam eder (uçtan uca doğrulandı).

### 4. PMS entegrasyonu
- Bildirim işçisi `reservation.created` ve `reservation.cancelled` olaylarını PMS'e `PUT /api/v1/reservations/{kod}` ile gönderir. **Olay kimliği `Idempotency-Key`'dir**; PMS aynı anahtarı tekrar işlemez. PMS ayrıca **eski `version`'ı reddeder** (iptal sonrası gelen geç "created" iptali ezmez).
- PMS'e yalnızca konaklamayı yürütmek için gereken veri gider; **pazarlama izni gönderilmez** (veri minimizasyonu).
- Sahte PMS (`pms-mock`) isteğe bağlı bozulabilir: `POST /admin/failure-mode {mode: ok|down|flaky}`. Bu, yeniden denemenin ve ölü mektubun **gösterilebilir** olması için vardır.
- **Operatör aracı:** `node dist/cli/replay-dead.js` ölü mektupları, taze deneme hakkıyla ana kuyruğa geri taşır (onaylı yeniden yayından sonra ack).

### 5. Onay e-postası
SMTP yok; "gönderim" yapılandırılmış bir log satırıdır (`LogMailSender`, `MailSender` arayüzünün arkasında). Olayda dil tercihi olmadığından e-posta TR+EN'dir.

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| İşleyici içinde `setTimeout` ile bekleyip tekrar deneme | Bekleme sırasında çökme/yeniden başlatma durumu kaybolur, kuyruğun başı bloke olur. |
| RabbitMQ gecikmeli mesaj eklentisi | Eklenti bağımlılığı; TTL + ölü mektup ek eklenti gerektirmez. |
| Mesaj başına `expiration` | RabbitMQ TTL'i yalnızca kuyruğun başında uygular; farklı süreler birbirini bloke eder. Bu yüzden bekleme süresi başına ayrı kuyruk. |
| Sonsuz yeniden deneme | Zehirli mesaj kuyruğu tıkar; sınır ve ölü mektup + operatör aracı daha güvenli. |
| Devre kesici (circuit breaker) | PMS kesintisinde her mesaj tek tek denenip bekler; bu ölçekte yeterli. Yüksek hacimde kesici eklenir (bilinen eksik). |

## Sonuçlar

- (+) PMS kesintisi: olaylar gecikir, kaybolmaz; PMS dönünce teslim edilir (Compose'ta uçtan uca denendi: PMS `down` → rezervasyon yapıldı → CRM anında güncel, PMS 2 sn + 10 sn sonra denemelerle başarılı).
- (+) Tüm yeniden deneme mantığı `routeFailure` saf fonksiyonunda ve gerçek broker testlerinde (başarı, geçici hata sonrası başarı, tükenince ölü mektup, zehirli mesaj, JSON olmayan gövde).
- (−) Duplicate teslimat mümkün (at-least-once): CRM gelen kutusu, PMS `Idempotency-Key`'i, e-posta ise **tekrarlanabilir** (gerçek sağlayıcıda `eventId` anahtar olmalı).
- (−) Retry süreleri değişirse yeni kuyruklar oluşur; eskileri (boşalınca) elle silinmeli.
- (−) Mesaj sırası yeniden denemede korunmaz; `version` kontrolü (CRM, PMS) bunu çözer.
- (−) Ölü mektup kuyruğu için otomatik alarm yok; yalnızca RabbitMQ arayüzünde (`:15672`) ve loglarda görünür.
