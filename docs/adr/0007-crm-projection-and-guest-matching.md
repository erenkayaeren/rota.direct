# ADR-0007: CRM projeksiyonu, misafir eşleştirme ve idempotent tüketici

- **Durum:** Kabul edildi, uygulandı ve test edildi (`services/crm/src/modules/guests`).
- **İlgili maddeler:** M10, M11, M12

## Bağlam

CRM, rezervasyon verisini yalnızca olaylardan alır (ADR-0001). Olaylar en az bir kez, gecikmeli ve sırası bozulabilir şekilde gelir (ADR-0006). Bir misafir birden çok rezervasyon yapar; CRM bunları **tek profilde** toplamalıdır. Yanlış birleştirme (iki ayrı kişiyi tek yapmak) KVKK açısından da yanlış kişiye veri göstermek demektir.

## Karar

### 1. Her olay tek transaction'da işlenir ve idempotenttir
`processed_events` (gelen kutusu) tablosuna olay kimliği, etkilerle **aynı transaction'da** yazılır: (1) olayı talep et (`INSERT … ON CONFLICT DO NOTHING`; ikinci teslimat bekler ve çakışır → `duplicate`), (2) oteli kaydet, (3) misafiri bul/oluştur, (4) rezervasyon anlık görüntüsünü yaz. Ortada çökme = tüm transaction geri alınır, olay yeniden teslim edilir.

### 2. Sırası bozulmuş olaylara karşı tek yönlü işaretçiler
- **Rezervasyon:** yalnızca **daha yüksek `version`** uygulanır. İptal (v2) yaratılıştan (v1) önce gelirse iptal uygulanır, sonra gelen v1 `stale` sayılıp atlanır.
- **Profil alanları (ad, telefon, rızalar):** misafirin **en son oluşturulan** rezervasyonu (`profile_as_of` = rezervasyonun `createdAt`'ı) kazanır. Olay zamanı değil rezervasyon zamanı kullanılır; böylece eski bir rezervasyonun iptal olayı, yeni rezervasyondaki güncel telefonu ya da **pazarlama izni geri çekilmesini** ezmez.

### 3. Misafir kimliği = otel + normalize e-posta
Eşleştirme anahtarı `(hotel_id, lower(trim(email)))`. Bilinçli olarak **yalnızca** bu:
- Gmail'deki nokta/`+etiket` katlaması yapılmaz (`a.yse@` ile `ayse@` farklı kişi sayılır).
- **Telefon, kimlik değil ipucudur.** Aynı telefonlu farklı e-postalı misafirler ayrı profildir; ayrıntıda "olası kopya" uyarısı olarak gösterilir, **otomatik birleştirilmez** (aile telefonu, acente, otel santrali gibi paylaşılan numaralar var).
- Misafirler **oteller arasında birleştirilmez**: her otel kendi misafirinin veri sorumlusudur; aynı e-posta iki otelde iki ayrı profildir.
- Aynı kişinin yeni misafir oluşturma yarışı: `(otel:e-posta)` üzerinde `pg_advisory_xact_lock`; aynı misafirin eş zamanlı 6 olayı tek profil üretir (testli). Bir rezervasyonun tüm olayları aynı e-postayı paylaştığından bu kilit onları birbirine karşı da sıralar.

### 4. Veri sahipliği
CRM kendi PostgreSQL veritabanına (ayrı konteyner) sahiptir; rezervasyon veritabanını okumaz. Notlar ve etiketler yalnızca CRM'de yaşar (`ON DELETE CASCADE`). Hotel bilgisi olaydan öğrenilir (`hotels` tablosu).

### 5. Zehirli mesaj
Sözleşmeyi bozan olay (`PoisonMessageError`) yeniden denenmez, doğrudan ölü mektup kuyruğuna gider (ADR-0008).

## Alternatifler

| Yöntem | Neden seçilmedi |
|---|---|
| Telefon veya ad+soyad ile otomatik birleştirme | Yanlış birleştirme geri alınamaz ve yanlış kişinin verisini gösterir; kopya, birleştirmeden ucuz. Birleştirme sonradan gösterilen ipucundan **elle** yapılabilir (kapsam dışı). |
| Misafiri oteller arası tek profil | Her otel ayrı kiracı ve ayrı veri sorumlusu; çapraz görünürlük ADR-0004'ün izolasyonunu bozar. |
| Olay zamanına göre "son yazan kazanır" | İptal gibi eski bir rezervasyonun geç olayı güncel profili ezer. |
| Rezervasyon servisinden senkron okuma | "Yalnızca olaylardan" kuralını ve bağımsızlığı bozar. |
| Gelen kutusu yerine yalnızca `version` kontrolü | Profil güncellemeleri ve istatistikler `version`'a bağlı değil; açık gelen kutusu en basit kesin yöntem. |

## Sonuçlar

- (+) Çift teslimat, geç/sırasız olay ve eş zamanlı yarış testle kanıtlı (`projection.test.ts`: 8 eş zamanlı aynı olay → 1 uygulama; sırasız iptal; eski rezervasyon pazarlama iznini ezmez).
- (+) İstatistikler (konaklama, gece, harcama) iptal edilenleri dışarıda bırakarak projeksiyondan SQL ile hesaplanır; liste ve detay aynı sorgudan türer.
- (−) Aynı kişi farklı e-postayla gelirse iki profil olur; birleştirme aracı yok (**bilinen eksik**).
- (−) `processed_events` büyür (temizlik yok).
- (−) KVKK silme/anonimleştirme talebi için CRM'de silme akışı yok; olaylar kişisel veri taşır (ADR-0006).
