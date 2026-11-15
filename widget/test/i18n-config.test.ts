import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';
import { errorMessage, messagesFor, resolveLanguage } from '../src/i18n/index.js';
import { en } from '../src/i18n/en.js';
import { tr } from '../src/i18n/tr.js';

/** Every error code the API documents (docs/api/openapi.yaml). A new code without copy fails here. */
const SERVER_ERROR_CODES = [
  'SOLD_OUT', 'ROOM_TYPE_NOT_FOUND', 'CAPACITY_EXCEEDED', 'CHECK_IN_IN_PAST', 'INVALID_DATE_RANGE',
  'STAY_TOO_LONG', 'OUTSIDE_BOOKING_WINDOW', 'INVALID_GUEST_COUNT', 'INVALID_EMAIL', 'INVALID_PHONE',
  'INVALID_GUEST_NAME', 'KVKK_CONSENT_REQUIRED', 'IDEMPOTENCY_KEY_REUSED', 'RESERVATION_NOT_FOUND',
  'INVALID_STATE_TRANSITION', 'INVALID_REQUEST', 'HOTEL_NOT_FOUND', 'ORIGIN_NOT_ALLOWED',
];

function shape(value: unknown): unknown {
  if (typeof value === 'function') return 'function';
  if (typeof value === 'string') return 'string';
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'errors').map(([k, v]) => [k, shape(v)]));
  }
  return typeof value;
}

describe('translations', () => {
  it('Turkish and English have exactly the same structure', () => {
    expect(shape(tr)).toEqual(shape(en));
  });
  it('both languages translate every documented server error code', () => {
    for (const messages of [tr, en]) {
      for (const code of SERVER_ERROR_CODES) expect(messages.errors[code], code).toBeTruthy();
      expect(Object.keys(messages.errors).sort()).toEqual(Object.keys(tr.errors).sort());
    }
  });
  it('falls back to the generic message for an unknown code', () => {
    expect(errorMessage(en, 'SOMETHING_NEW')).toBe(en.errors.generic);
    expect(errorMessage(en, undefined)).toBe(en.errors.generic);
    expect(errorMessage(tr, 'SOLD_OUT')).toBe(tr.errors['SOLD_OUT']);
  });
  it('pluralises nights and guests properly', () => {
    expect(en.nights(1)).toBe('1 night');
    expect(en.nights(3)).toBe('3 nights');
    expect(en.guests(2, 1)).toBe('2 adults, 1 child');
    expect(tr.guests(2, 0)).toBe('2 yetişkin');
    expect(messagesFor('tr')).toBe(tr);
  });
});

describe('resolveLanguage', () => {
  it('honours an explicit language', () => {
    expect(resolveLanguage('en', ['tr-TR'])).toBe('en');
    expect(resolveLanguage('TR', ['en-US'])).toBe('tr');
  });
  it('follows the browser on "auto" and falls back to Turkish', () => {
    expect(resolveLanguage('auto', ['de-DE', 'en-US'])).toBe('en');
    expect(resolveLanguage(null, ['de-DE'])).toBe('tr');
    expect(resolveLanguage('fr', ['fr-FR'])).toBe('tr');
  });
});

describe('readConfig', () => {
  const element = (attributes: Record<string, string>): Element => {
    const el = document.createElement('div');
    for (const [k, v] of Object.entries(attributes)) el.setAttribute(k, v);
    return el;
  };
  const read = (attributes: Record<string, string>) => readConfig(element(attributes), 'https://api.example.com', ['en']);

  it('reads a minimal configuration and defaults the API to the script origin', () => {
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo' })).toEqual({
      ok: true,
      config: { hotelKey: 'pk_lagos_beach_demo', apiBase: 'https://api.example.com', language: 'en', accent: null, kvkkUrl: null },
    });
  });
  it('requires a plausible hotel key', () => {
    expect(read({})).toMatchObject({ ok: false });
    expect(read({ 'hotel-key': '<script>' })).toMatchObject({ ok: false });
  });
  it('trims a trailing slash from api-base and rejects non-http URLs', () => {
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo', 'api-base': 'http://localhost:3000/' })).toMatchObject({ config: { apiBase: 'http://localhost:3000' } });
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo', 'api-base': 'javascript:alert(1)' })).toMatchObject({ ok: false });
  });
  it('accepts only #rrggbb accents (no CSS injection through an attribute)', () => {
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo', accent: '#a1b2c3' })).toMatchObject({ config: { accent: '#a1b2c3' } });
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo', accent: 'red; background:url(x)' })).toMatchObject({ config: { accent: null } });
  });
  it('accepts only http(s) KVKK links', () => {
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo', 'kvkk-url': 'https://hotel.example/kvkk' })).toMatchObject({ config: { kvkkUrl: 'https://hotel.example/kvkk' } });
    expect(read({ 'hotel-key': 'pk_lagos_beach_demo', 'kvkk-url': 'javascript:alert(1)' })).toMatchObject({ config: { kvkkUrl: null } });
  });
});
