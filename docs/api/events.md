# Olay sözleşmesi (reservation → CRM, PMS, e-posta)

Servisler arasındaki **tek** bağ budur ([ADR-0006](../adr/0006-event-contract-outbox-relay-rabbitmq.md)). Üretici: `reservation-relay`. Tüketiciler: `crm`, `pms-notifier` (PMS + e-posta).

## Taşıma

| | |
|---|---|
| Broker | RabbitMQ, topic exchange **`rota.events`** (dayanıklı) |
| Yönlendirme anahtarı | olay türü: `reservation.created`, `reservation.cancelled` |
| Mesaj | kalıcı (persistent), `content-type: application/json`, `messageId` = `eventId`, başlıklar: `hotelId`, `version` |
| Teslimat | **en az bir kez**; yinelenebilir ve sırası bozulabilir. Tüketici `eventId` ile tekilleştirir, `version` ile eskiyi atlar |
| Kuyruklar | her tüketicinin kendi kuyruğu: `crm.reservation-events`, `pms.reservation-events`, `mail.reservation-events` (+ `.retry.<N>ms`, `.dead`, bkz. [ADR-0008](../adr/0008-consumer-retry-dead-letter-and-pms.md)) |

## Zarf

```json
{
  "eventId": "6f1c1c0e-…",          // outbox satır kimliği; tekilleştirme anahtarı
  "type": "reservation.created",    // | reservation.cancelled
  "occurredAt": "2026-10-26T12:00:00.000Z",
  "hotelId": "…",                    // = data.hotel.id
  "aggregateId": "…",                // = data.reservationId
  "version": 1,                      // rezervasyonun sürümü; her durum değişiminde artar
  "data": { … }                      // aşağıdaki tam anlık görüntü
}
```

## `data`: rezervasyonun değişiklik SONRASI tam anlık görüntüsü

```json
{
  "hotel": { "id": "…", "key": "pk_lagos_beach_demo", "name": "Lagos Beach Hotel" },
  "reservationId": "…",
  "hotelId": "…",
  "code": "RT-7K3MQ9XA",
  "status": "CONFIRMED",             // CONFIRMED | CANCELLED (| PENDING, CHECKED_IN, CHECKED_OUT, NO_SHOW ileride)
  "version": 1,
  "roomTypeId": "…",
  "roomType": { "id": "…", "code": "standard", "name": { "tr": "Standart", "en": "Standard" } },
  "checkIn": "2026-11-10",           // takvim günü, saat dilimi yok
  "checkOut": "2026-11-13",
  "adults": 2,
  "children": 0,
  "totalPriceMinor": 960000,         // tam sayı, kuruş
  "currency": "TRY",
  "guest": { "firstName": "Ayşe", "lastName": "Yılmaz", "email": "ayse@example.com", "phone": "+905321234567" },
  "consents": {
    "kvkkAcceptedAt": "2026-10-26T12:00:00.000Z",
    "marketing": true,
    "marketingConsentedAt": "2026-10-26T12:00:00.000Z"
  },
  "createdAt": "2026-10-26T12:00:00.000Z",
  "cancelledAt": null
}
```

E-posta küçük harfe çevrilmiş, telefon E.164'tür. **Kişisel veri içerir**: yalnızca iç ağda dolaşır; PMS'e giden alt küme pazarlama iznini içermez.

## Uyumluluk kuralları

- **Tolerant reader:** tüketici bilmediği alanları yok sayar. Üretici **alan ekleyebilir**; alan silmek/anlamını değiştirmek yeni olay türü (veya sürüm) gerektirir.
- Tüketici bilmediği `type`'ı **atlar** (ack), hata saymaz.
- Sözleşmeyi bozan mesaj yeniden denenmez; `*.dead` kuyruğuna gider.
- Tam anlık görüntü olduğundan "yalnızca en yüksek `version`'ı tut" her zaman doğru duruma götürür.

## Tüketici tarafı

| Tüketici | Ne yapar | Tekilleştirme |
|---|---|---|
| CRM | misafir profili + rezervasyon projeksiyonu ([ADR-0007](../adr/0007-crm-projection-and-guest-matching.md)) | `processed_events` + `version` |
| PMS işçisi | `PUT /api/v1/reservations/{kod}` | PMS `Idempotency-Key` = `eventId`, PMS `version` kontrolü |
| E-posta | onay/iptal e-postası (log) | yok (tekrarlanabilir; gerçek sağlayıcıda `eventId` anahtar olmalı) |
