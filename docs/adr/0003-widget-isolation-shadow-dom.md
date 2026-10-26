# ADR-0003: Widget izolasyonu: Shadow DOM

- **Durum:** Kabul edildi.
- **İlgili maddeler:** M1, S4, B5

## Bağlam

Widget, otelin sitesine tek satır `<script src=".../widget.js" data-hotel-key="...">` ile gömülür. Host sayfanın CSS'i widget'ı bozmamalı, widget'ın CSS'i de host sayfayı bozmamalı. Host sayfaya hiçbir kontrolümüz yok (agresif global CSS, eski jQuery, farklı font boyutları olabilir).

## Karar

Widget bir **custom element** (`<rota-booking-widget>`) olarak, **Shadow DOM** içinde render edilir:

- `widget.js` ilk satırda `document.currentScript`'ten `data-hotel-key`'i okur ve script'in yanına host element'i ekler.
- Tüm stiller shadow root içindeki `<style>` ile gelir; global `document`'a stil enjekte edilmez. Host CSS'i shadow sınırını geçemez, widget CSS'i dışarı sızmaz.
- Kalıtılan özellikler (`font`, `color`, `line-height`) shadow sınırından geçtiği için `:host { all: initial }` ile sıfırlanır ve widget kendi değerlerini tanımlar.
- Birimler `px`/kendi kök değerimiz üzerinden; host `html { font-size }` değerinden etkilenen `rem` kullanılmaz.
- Font olarak sistem font stack'i (shadow içindeki `@font-face` tanımları belgeye uygulanmadığı için web font yüklemeyeceğiz).
- Küçük bundle için Preact (B5'te ölçülüp raporlanacak).

## Alternatifler

| Yöntem | Artı | Eksi |
|---|---|---|
| **iframe** | JS + CSS + origin açısından tam izolasyon | Yükseklik/boyut için `postMessage` + `ResizeObserver`; mobil klavye ve scroll sorunları; ayrı HTML belgesi (ek istek); host sayfa analitiği/erişilebilirlik entegrasyonu zor. Ödeme formu olsaydı (PCI) tercih edilirdi; burada ödeme kapsam dışı. |
| **Ad alanlı CSS** (`.rota-` öneki, BEM) | En basit, her yerde çalışır | Yalnızca konvansiyon: host'un `button { … }` veya `!important` kuralları yine sızar; garanti yok. |
| **CSS-in-JS + `all: initial` sarmalayıcı** | Shadow DOM desteği olmayan eski tarayıcılarda çalışır | Özgüllük savaşını kazanmak mümkün değil; yarı izolasyon. |

## Sonuçlar

- (+) Stil izolasyonu tarayıcı tarafından **garanti edilir**, konvansiyona bağlı değil.
- (+) Boyutlandırma doğal (iframe'in aksine içerik host sayfa akışında).
- (−) `mode: 'open'` shadow root'a host'un JS'i erişebilir: bu **stil** izolasyonudur, güvenlik sınırı değildir. Widget'ta gizli bilgi olmadığı (hotel key herkese açık) için kabul edilebilir.
- (−) Modal/overlay ve odak yönetimi host sayfa üzerinde ayrıca ele alınmalı; `z-index` savaşı için widget kendi katmanını açar.
- Doğrulama: agresif global CSS'e sahip bir "düşman" test sayfasında widget'ın bozulmadığı ve sayfanın widget'tan etkilenmediği gösterilecek.
