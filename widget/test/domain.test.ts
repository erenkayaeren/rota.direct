import { describe, expect, it } from 'vitest';
import { addDaysIso, isValidIsoDate, nightsBetween, toIsoDate } from '../src/domain/dates.js';
import { newIdempotencyKey } from '../src/domain/ids.js';
import { formatMoney } from '../src/domain/money.js';
import { validateGuest, validateSearch } from '../src/domain/validation.js';

describe('dates', () => {
  it('formats the visitor-local calendar day without a time zone shift', () => {
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('validates real calendar days only', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-2-3')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });
  it('adds days across month and year ends', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('counts nights', () => {
    expect(nightsBetween('2026-11-10', '2026-11-13')).toBe(3);
    expect(nightsBetween('2026-11-13', '2026-11-10')).toBe(-3);
    expect(nightsBetween('x', '2026-11-10')).toBeNaN();
  });
});

describe('formatMoney', () => {
  it('shows whole amounts without decimals and fractions with two', () => {
    expect(formatMoney(320_000, 'TRY', 'tr-TR').replace(/\s/g, ' ')).toBe('₺3.200');
    expect(formatMoney(320_050, 'TRY', 'tr-TR')).toContain('3.200,50');
    expect(formatMoney(96_000_0, 'TRY', 'en-GB')).toContain('9,600');
  });
});

describe('validateSearch (M2)', () => {
  const today = '2026-10-26';
  const ok = { checkIn: '2026-11-01', checkOut: '2026-11-04', adults: 2, children: 0 };
  it('accepts a normal search', () => {
    expect(validateSearch(ok, today)).toEqual({});
    expect(validateSearch({ ...ok, checkIn: today }, today)).toEqual({}); // today is bookable
  });
  it.each([
    ['past check-in', { checkIn: '2026-10-25' }, 'checkIn', 'pastDate'],
    ['missing check-in', { checkIn: '' }, 'checkIn', 'dateRequired'],
    ['check-out equals check-in', { checkOut: '2026-11-01' }, 'checkOut', 'checkOutAfterCheckIn'],
    ['check-out before check-in', { checkOut: '2026-10-30' }, 'checkOut', 'checkOutAfterCheckIn'],
    ['31 nights', { checkOut: '2026-12-02' }, 'checkOut', 'tooLong'],
    ['beyond the booking window', { checkIn: '2027-10-20', checkOut: '2027-10-30' }, 'checkOut', 'tooFar'],
    ['zero adults', { adults: 0 }, 'adults', 'adultsRange'],
    ['11 adults', { adults: 11 }, 'adults', 'adultsRange'],
    ['negative children', { children: -1 }, 'children', 'childrenRange'],
    ['fractional adults', { adults: 1.5 }, 'adults', 'adultsRange'],
  ])('rejects %s', (_name, change, field, key) => {
    expect(validateSearch({ ...ok, ...change }, today)).toMatchObject({ [field]: key });
  });
});

describe('validateGuest', () => {
  const guest = { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '0532 123 45 67' };
  it('accepts a complete form with the KVKK notice acknowledged', () => {
    expect(validateGuest(guest, { kvkk: true, marketing: false })).toEqual({});
  });
  it('requires the KVKK acknowledgement but never the marketing consent', () => {
    expect(validateGuest(guest, { kvkk: false, marketing: true })).toEqual({ kvkk: 'kvkkRequired' });
    expect(validateGuest(guest, { kvkk: true, marketing: false })).toEqual({});
  });
  it.each([
    [{ firstName: '  ' }, 'firstName', 'required'],
    [{ lastName: '' }, 'lastName', 'required'],
    [{ email: '' }, 'email', 'required'],
    [{ email: 'nope' }, 'email', 'invalidEmail'],
    [{ email: 'a@b' }, 'email', 'invalidEmail'],
    [{ phone: '' }, 'phone', 'required'],
    [{ phone: 'abc' }, 'phone', 'invalidPhone'],
    [{ phone: '123' }, 'phone', 'invalidPhone'],
  ])('flags %j', (change, field, key) => {
    expect(validateGuest({ ...guest, ...change }, { kvkk: true, marketing: false })).toMatchObject({ [field]: key });
  });
  it('accepts international numbers', () => {
    expect(validateGuest({ ...guest, phone: '+44 20 7946 0958' }, { kvkk: true, marketing: false })).toEqual({});
  });
});

describe('newIdempotencyKey', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it('uses crypto.randomUUID when available', () => {
    expect(newIdempotencyKey()).toMatch(uuid);
  });
  it('falls back to getRandomValues on insecure contexts (plain-http hotel sites)', () => {
    const fake = { getRandomValues: (a: Uint8Array) => a.fill(0xab) } as unknown as Crypto;
    const key = newIdempotencyKey(fake);
    expect(key).toMatch(uuid);
    expect(key.length).toBeGreaterThanOrEqual(16); // the server accepts 16-128 characters
  });
  it('produces different keys', () => {
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});
