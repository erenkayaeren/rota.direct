# ADR-0010: CRM personel erişimi ve panel güvenliği

- **Durum:** Kabul edildi, uygulandı ve gerçek tarayıcıda doğrulandı (`services/crm/src/modules/access`, `services/crm/panel`).
- **İlgili maddeler:** M9, M12

## Bağlam

CRM misafirlerin kişisel verisini (ad, e-posta, telefon, rızalar, notlar) tutar. Yalnızca o otelin personeli kendi otelinin misafirlerini görmeli (ADR-0004'ün CRM'deki karşılığı) ve panel, misafirin yazdığı içerik (ad, not, etiket) yüzünden depolanmış XSS'e açık olmamalı.

## Karar

### Kimlik doğrulama: opak bearer token
- Her personel kullanıcısının uzun rastgele bir token'ı vardır; veritabanında yalnızca **SHA-256 özeti** saklanır (yüksek entropili sır için hızlı özet yeterlidir). İstek `Authorization: Bearer <token>`; eksik/yanlış → `401 UNAUTHENTICATED` + `WWW-Authenticate: Bearer`.
- **Otel token'dan gelir**, istekten değil: kullanıcı `hotel_key`'e bağlıdır ve her sorgu `hotel_id` ile süzülür. Başka otelin misafiri `404 GUEST_NOT_FOUND` döner (var olup olmadığı sızmaz); not/etiket yazımı da aynı sınırdadır (testli).
- Hotel henüz olay üretmediyse `hotel_id` yerine sıfır UUID kullanılır: hiçbir satırla eşleşmez, boş liste döner.
- Tüm API yanıtları `Cache-Control: no-store` (kişisel veri).
- Panel token'ı `sessionStorage`'da tutar (sekme kapanınca gider); `401` alınca oturum kapanır.

### Panel güvenliği
- **Hiçbir kullanıcı verisi `innerHTML` ile basılmaz.** Panel küçük bir DOM oluşturucu (`h()`) kullanır; metin `createTextNode` ile eklenir. Doğrulama: nota `<img src=x onerror=alert(1)><script>…` yazıldı, gerçek Chrome'da düz metin olarak göründü, hiçbir `alert` çalışmadı, `img` düğümü oluşmadı.
- **Sıkı CSP** (panel dosyalarında): `default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, ayrıca `nosniff` ve `Referrer-Policy: no-referrer`. Satır içi script/stil yok; bir XSS hatası bile dışarıdan script yükleyemez, clickjacking engellenir.
- Panel, API ile aynı kökenden servis edilir: CORS gerekmez ve açılmaz.
- Panel derleme adımı olmayan düz ES modülleridir; saf yardımcılar (`lib.js`) birim testlidir.

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| JWT | İptal (revocation) ve rotasyon için yine veritabanı gerekir; opak token ek karmaşıklık olmadan aynı işi görür. İstemci tarafında claim okuma ihtiyacı yok. |
| Oturum çerezi | CSRF koruması gerekir; bearer token + `sessionStorage` bu ölçekte daha basit. XSS riski CSP ve `textContent` ile ayrıca kapatıldı. |
| Panelde React/Preact | Derleme hattı ve bağımlılık ekler; ekran sayısı az. Güvenli DOM oluşturucu aynı riski daha küçük yüzeyle çözer. |
| OIDC / SSO | Gerçek bir ürün için doğru yön; bu aşamada kapsam dışı. |

## Sonuçlar

- (+) Basit, denetlenebilir; tenant izolasyonu sorgu düzeyinde ve testli.
- (−) **Demo token'ları README'de yayınlıdır** (`SEED_DEMO_DATA=true` ile yüklenir); üretimde asla. Token oluşturma/döndürme/iptal arayüzü yok (**bilinen eksik**).
- (−) Token denemelerine karşı hız sınırı yok; 256 bit'e yakın rastgele token'da pratikte tahmin edilemez ama sınırlama eklenmeli.
- (−) Denetim kaydı (kim hangi misafire baktı/not yazdı) yok; notlar yazar adını taşır.
- (−) Panel yalnızca Türkçe.
