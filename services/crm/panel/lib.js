// Pure helpers of the staff panel (no DOM, no network), so they can be unit tested.

/** Integer minor units (kurus) -> "3.200 ₺". Whole amounts drop the decimals. */
export function formatMoney(amountMinor, currency = 'TRY') {
  const whole = amountMinor % 100 === 0;
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amountMinor / 100);
}

/** "2026-11-10" -> "10 Kas 2026" (calendar date, no time zone shift). */
export function formatDate(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso.slice(0, 10)}T00:00:00Z`),
  );
}

/** ISO timestamp -> "26 Eki 2026 15:04" in the staff member's local time. */
export function formatDateTime(iso) {
  if (!iso) return '-';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "#/guests/abc?q=x&page=2" -> { path: ['guests','abc'], query: { q: 'x', page: '2' } } */
export function parseHash(hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const path = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(queryPart));
  return { path, query };
}

/** Inverse of parseHash. Empty query values are dropped so URLs stay short. */
export function buildHash(path, query = {}) {
  const pairs = Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '');
  const search = new URLSearchParams(pairs).toString();
  return `#/${path.map(encodeURIComponent).join('/')}${search ? `?${search}` : ''}`;
}

/** Page buttons to show: first, last, and a window around the current page; null = "…". */
export function pageWindow(page, totalPages, radius = 2) {
  if (totalPages <= 1) return [1];
  const pages = new Set([1, totalPages]);
  for (let p = page - radius; p <= page + radius; p++) if (p >= 1 && p <= totalPages) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) result.push(null);
    result.push(p);
  });
  return result;
}

const STATUS = {
  CONFIRMED: ['Onaylı', 'ok'],
  PENDING: ['Beklemede', 'warn'],
  CHECKED_IN: ['Konaklıyor', 'ok'],
  CHECKED_OUT: ['Çıkış yaptı', 'muted'],
  CANCELLED: ['İptal', 'bad'],
  NO_SHOW: ['Gelmedi', 'bad'],
};

export function statusInfo(status) {
  const [label, tone] = STATUS[status] ?? [status, 'muted'];
  return { label, tone };
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
