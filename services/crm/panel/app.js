import { api, ApiError, session, setUnauthorizedHandler } from './api.js';
import { clear, h } from './dom.js';
import { buildHash, debounce, formatDate, formatDateTime, formatMoney, pageWindow, parseHash, statusInfo } from './lib.js';

const root = document.getElementById('app');
let me = null; // { name, hotel: { key, name } }

const ERROR_TEXT = {
  UNAUTHENTICATED: 'Oturumunuz geçersiz. Lütfen yeniden giriş yapın.',
  GUEST_NOT_FOUND: 'Bu misafir bulunamadı.',
  INVALID_TAG: 'Etiket 1-30 karakter olmalı: harf, rakam ve "-".',
  TOO_MANY_TAGS: 'Bir misafire en fazla 20 etiket eklenebilir.',
  INVALID_NOTE: 'Not 1-2000 karakter olmalı.',
};
const errorText = (error) => ERROR_TEXT[error.code] ?? error.message ?? 'Bir sorun oluştu.';

function logout() {
  session.clear();
  me = null;
  location.hash = '#/login';
}
setUnauthorizedHandler(() => {
  if (me !== null) logout();
});

/* ---------------------------------------------------------------- shell */

function shell(content) {
  clear(root);
  root.append(
    h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, h('strong', {}, 'Rota CRM'), h('span', { class: 'hotel' }, me?.hotel.name ?? me?.hotel.key ?? '')),
      h('div', { class: 'who' },
        h('span', {}, me?.name ?? ''),
        h('button', { class: 'link', type: 'button', onclick: logout }, 'Çıkış')),
    ),
    h('main', { class: 'content' }, content),
  );
}

function notice(message, tone = 'bad') {
  return h('div', { class: `notice ${tone}`, role: 'alert' }, message);
}

/* ---------------------------------------------------------------- login */

function renderLogin() {
  clear(root);
  const error = h('div', { 'aria-live': 'polite' });
  const input = h('input', { id: 'token', type: 'password', autocomplete: 'off', required: true, placeholder: 'Personel anahtarı' });
  const form = h('form', { class: 'login', onsubmit: async (event) => {
    event.preventDefault();
    clear(error);
    try {
      me = await api('/me', { token: input.value.trim() });
      session.set(input.value.trim());
      location.hash = '#/guests';
    } catch (failure) {
      error.append(notice(failure instanceof ApiError && failure.status === 401 ? 'Anahtar geçersiz.' : errorText(failure)));
    }
  } },
    h('h1', {}, 'Rota CRM'),
    h('p', { class: 'muted' }, 'Otel personeli girişi'),
    h('label', { for: 'token' }, 'Personel anahtarı'),
    input,
    error,
    h('button', { class: 'primary', type: 'submit' }, 'Giriş yap'),
  );
  root.append(h('div', { class: 'login-wrap' }, form));
  input.focus();
}

/* ---------------------------------------------------------------- guest list */

const SORTS = [['recent', 'Son rezervasyon'], ['name', 'Soyad'], ['spend', 'Harcama']];

function renderGuests(query) {
  const state = {
    q: query.q ?? '',
    tag: query.tag ?? '',
    marketing: query.marketing ?? '',
    sort: SORTS.some(([key]) => key === query.sort) ? query.sort : 'recent',
    page: Math.max(1, Number(query.page) || 1),
  };
  const results = h('div', { 'aria-live': 'polite' });

  const go = (change) => { location.hash = buildHash(['guests'], { ...state, ...change }); };
  const search = debounce((value) => go({ q: value, page: 1 }), 300);

  const controls = h('form', { class: 'filters', role: 'search', onsubmit: (event) => event.preventDefault() },
    h('input', { type: 'search', 'aria-label': 'Misafir ara', placeholder: 'Ad, e-posta, telefon veya rezervasyon kodu', value: state.q, oninput: (e) => search(e.target.value) }),
    h('input', { type: 'text', 'aria-label': 'Etiket', placeholder: 'Etiket', value: state.tag, maxlength: '60', onchange: (e) => go({ tag: e.target.value.trim(), page: 1 }) }),
    select('Pazarlama izni', state.marketing, [['', 'Tüm misafirler'], ['true', 'Pazarlama izni var'], ['false', 'Pazarlama izni yok']], (value) => go({ marketing: value, page: 1 })),
    select('Sıralama', state.sort, SORTS, (value) => go({ sort: value, page: 1 })),
  );

  shell([h('h1', {}, 'Misafirler'), controls, results]);

  (async () => {
    results.append(h('p', { class: 'muted' }, 'Yükleniyor…'));
    try {
      const data = await api('/guests', { query: { ...state, pageSize: 15 } });
      clear(results);
      results.append(guestTable(data), pager(data, (page) => go({ page })));
    } catch (error) {
      clear(results);
      results.append(notice(errorText(error)));
    }
  })();
}

function select(label, value, options, onchange) {
  return h('select', { 'aria-label': label, onchange: (e) => onchange(e.target.value) },
    options.map(([optionValue, text]) => h('option', { value: optionValue, selected: optionValue === value }, text)));
}

function guestTable(data) {
  if (data.items.length === 0) return h('p', { class: 'empty' }, 'Eşleşen misafir yok.');
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Misafir', 'İletişim', 'Etiketler', 'Konaklama', 'Harcama', 'Son giriş', 'Pazarlama'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, data.items.map((guest) => h('tr', {},
      h('td', {}, h('a', { href: buildHash(['guests', guest.id]) }, `${guest.firstName} ${guest.lastName}`)),
      h('td', {}, h('div', {}, guest.email), h('div', { class: 'muted' }, guest.phone)),
      h('td', {}, tagChips(guest.tags)),
      h('td', { class: 'num' }, `${guest.stats.reservations} (${guest.stats.nights} gece)`),
      h('td', { class: 'num' }, guest.stats.currency ? formatMoney(guest.stats.spentMinor, guest.stats.currency) : '-'),
      h('td', {}, formatDate(guest.stats.lastCheckIn)),
      h('td', {}, h('span', { class: `badge ${guest.marketingConsent ? 'ok' : 'muted'}` }, guest.marketingConsent ? 'İzinli' : 'İzin yok')),
    ))),
  ));
}

function tagChips(tags) {
  return h('div', { class: 'chips' }, tags.map((tag) => h('span', { class: 'chip' }, tag)));
}

function pager(data, onPage) {
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.total, data.page * data.pageSize);
  return h('nav', { class: 'pager', 'aria-label': 'Sayfalama' },
    h('span', { class: 'muted' }, `${from}-${to} / ${data.total} misafir`),
    h('div', { class: 'pages' },
      h('button', { type: 'button', disabled: data.page <= 1, onclick: () => onPage(data.page - 1) }, 'Önceki'),
      pageWindow(data.page, totalPages).map((p) => p === null
        ? h('span', { class: 'gap' }, '…')
        : h('button', { type: 'button', class: p === data.page ? 'current' : '', 'aria-current': p === data.page ? 'page' : undefined, onclick: () => onPage(p) }, String(p))),
      h('button', { type: 'button', disabled: data.page >= totalPages, onclick: () => onPage(data.page + 1) }, 'Sonraki'),
    ),
  );
}

/* ---------------------------------------------------------------- guest detail */

async function renderGuest(id, backQuery) {
  const body = h('div', {}, h('p', { class: 'muted' }, 'Yükleniyor…'));
  shell([h('a', { class: 'back', href: buildHash(['guests'], backQuery) }, '← Misafirler'), body]);
  try {
    const guest = await api(`/guests/${encodeURIComponent(id)}`);
    clear(body);
    body.append(guestDetail(guest));
  } catch (error) {
    clear(body);
    body.append(notice(errorText(error)));
  }
}

function guestDetail(guest) {
  const flash = h('div', { 'aria-live': 'polite' });
  const showError = (error) => { clear(flash); flash.append(notice(errorText(error))); };

  /* tags */
  let tags = [...guest.tags];
  const chips = h('div', { class: 'chips editable' });
  const tagInput = h('input', { type: 'text', 'aria-label': 'Yeni etiket', placeholder: 'Etiket ekle (örn. vip)', maxlength: '60' });
  const saveTags = async (next) => {
    try {
      tags = (await api(`/guests/${guest.id}/tags`, { method: 'PUT', body: { tags: next } })).tags;
      clear(flash);
    } catch (error) { showError(error); }
    drawTags();
  };
  const drawTags = () => {
    clear(chips);
    tags.forEach((tag) => chips.append(h('span', { class: 'chip' }, tag,
      h('button', { type: 'button', class: 'chip-x', 'aria-label': `${tag} etiketini kaldır`, onclick: () => saveTags(tags.filter((t) => t !== tag)) }, '×'))));
    if (tags.length === 0) chips.append(h('span', { class: 'muted' }, 'Etiket yok'));
  };
  drawTags();
  const tagForm = h('form', { class: 'inline', onsubmit: async (event) => {
    event.preventDefault();
    const value = tagInput.value.trim();
    if (value === '') return;
    tagInput.value = '';
    await saveTags([...tags, value]);
  } }, tagInput, h('button', { type: 'submit' }, 'Ekle'));

  /* notes */
  const notes = h('ul', { class: 'notes' });
  const drawNote = (note) => h('li', {}, h('p', { class: 'note-body' }, note.body), h('p', { class: 'muted' }, `${note.author} · ${formatDateTime(note.createdAt)}`));
  guest.notes.forEach((note) => notes.append(drawNote(note)));
  const noteInput = h('textarea', { 'aria-label': 'Yeni not', rows: '3', maxlength: '2000', placeholder: 'Misafir hakkında not (örn. deniz manzarası istedi)' });
  const noteForm = h('form', { class: 'note-form', onsubmit: async (event) => {
    event.preventDefault();
    if (noteInput.value.trim() === '') return;
    try {
      const note = await api(`/guests/${guest.id}/notes`, { method: 'POST', body: { body: noteInput.value } });
      noteInput.value = '';
      notes.prepend(drawNote(note));
      clear(flash);
    } catch (error) { showError(error); }
  } }, noteInput, h('button', { class: 'primary', type: 'submit' }, 'Notu kaydet'));

  const s = guest.stats;
  return h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('div', {},
        h('h1', {}, `${guest.firstName} ${guest.lastName}`),
        h('p', {}, guest.email, ' · ', guest.phone),
        h('p', { class: 'muted' }, `Profil oluşturuldu: ${formatDateTime(guest.createdAt)}`)),
      h('span', { class: `badge big ${guest.marketingConsent ? 'ok' : 'muted'}` }, guest.marketingConsent ? 'Pazarlama izni var' : 'Pazarlama izni yok')),
    flash,
    guest.possibleDuplicates.length > 0 && h('div', { class: 'notice warn' },
      'Aynı telefon numarasına sahip başka misafir(ler): ',
      guest.possibleDuplicates.map((d, i) => [i > 0 && ', ', h('a', { href: buildHash(['guests', d.id]) }, `${d.firstName} ${d.lastName} (${d.email})`)])),
    h('div', { class: 'stats' },
      stat('Konaklama', s.reservations), stat('Gece', s.nights), stat('Toplam harcama', s.currency ? formatMoney(s.spentMinor, s.currency) : '-'), stat('İptal', s.cancelled)),
    h('section', {}, h('h2', {}, 'Rızalar (KVKK)'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'Aydınlatma metni onayı'), h('dd', {}, formatDateTime(guest.kvkkAcceptedAt)),
        h('dt', {}, 'Pazarlama izni'), h('dd', {}, guest.marketingConsentedAt ? formatDateTime(guest.marketingConsentedAt) : 'Verilmedi'))),
    h('section', {}, h('h2', {}, 'Etiketler'), chips, tagForm),
    h('section', {}, h('h2', {}, 'Rezervasyonlar'), reservationTable(guest.reservations)),
    h('section', {}, h('h2', {}, 'Notlar'), noteForm, notes),
  );
}

const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'muted' }, label));

function reservationTable(reservations) {
  if (reservations.length === 0) return h('p', { class: 'empty' }, 'Rezervasyon yok.');
  return h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['Kod', 'Oda', 'Tarihler', 'Gece', 'Tutar', 'Durum'].map((c) => h('th', { scope: 'col' }, c)))),
    h('tbody', {}, reservations.map((r) => {
      const status = statusInfo(r.status);
      return h('tr', {},
        h('td', { class: 'mono' }, r.code),
        h('td', {}, r.roomType.name.tr),
        h('td', {}, `${formatDate(r.checkIn)} – ${formatDate(r.checkOut)}`),
        h('td', { class: 'num' }, String(r.nights)),
        h('td', { class: 'num' }, formatMoney(r.totalPriceMinor, r.currency)),
        h('td', {}, h('span', { class: `badge ${status.tone}` }, status.label), r.cancelledAt && h('span', { class: 'muted' }, ` ${formatDate(r.cancelledAt)}`)));
    })),
  ));
}

/* ---------------------------------------------------------------- router */

async function route() {
  const { path, query } = parseHash(location.hash);
  if (path[0] === 'login' || !session.get()) {
    if (path[0] !== 'login') { location.hash = '#/login'; return; }
    renderLogin();
    return;
  }
  if (me === null) {
    try { me = await api('/me'); } catch { return; }
  }
  if (path[0] === 'guests' && path[1]) return renderGuest(path[1], {});
  if (path[0] === 'guests' || path.length === 0) return renderGuests(query);
  location.hash = '#/guests';
}

addEventListener('hashchange', route);
route();
