import { describe, expect, it } from 'vitest';
import {
  addDays,
  assertValidTimeZone,
  diffDays,
  eachNight,
  localDate,
  parseLocalDate,
  todayInZone,
} from '../../../src/shared/local-date.js';

describe('parseLocalDate', () => {
  it('accepts real calendar dates, including leap days', () => {
    expect(parseLocalDate('2026-11-01')).toBe('2026-11-01');
    expect(parseLocalDate('2028-02-29')).toBe('2028-02-29');
  });

  it('rejects impossible dates and wrong formats', () => {
    const invalid = [
      '2026-02-30',
      '2027-02-29',
      '2026-13-01',
      '2026-00-10',
      '2026-1-1',
      '26-01-01',
      '2026-11-01T10:00:00Z',
      '',
      'tomorrow',
    ];
    for (const value of invalid) {
      expect(parseLocalDate(value)).toBeNull();
    }
  });
});

describe('addDays and diffDays', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays(localDate('2026-12-31'), 1)).toBe('2027-01-01');
    expect(addDays(localDate('2026-03-01'), -1)).toBe('2026-02-28');
    expect(addDays(localDate('2028-02-28'), 1)).toBe('2028-02-29');
  });

  it('is exact across a daylight-saving change day', () => {
    expect(addDays(localDate('2026-03-28'), 1)).toBe('2026-03-29');
    expect(diffDays(localDate('2026-03-28'), localDate('2026-03-30'))).toBe(2);
  });

  it('counts whole days in both directions', () => {
    expect(diffDays(localDate('2026-11-01'), localDate('2026-11-04'))).toBe(3);
    expect(diffDays(localDate('2026-11-04'), localDate('2026-11-01'))).toBe(-3);
    expect(diffDays(localDate('2026-11-01'), localDate('2026-11-01'))).toBe(0);
  });
});

describe('eachNight', () => {
  it('includes check-in and excludes check-out', () => {
    expect(eachNight(localDate('2026-11-01'), localDate('2026-11-04'))).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });

  it('is empty when there is no stay', () => {
    expect(eachNight(localDate('2026-11-01'), localDate('2026-11-01'))).toHaveLength(0);
  });
});

describe('todayInZone', () => {
  it('uses the hotel zone, not UTC: Istanbul is already on the 27th at 22:30 UTC', () => {
    const instant = new Date('2026-10-26T22:30:00Z');
    expect(todayInZone(instant, 'UTC')).toBe('2026-10-26');
    expect(todayInZone(instant, 'Europe/Istanbul')).toBe('2026-10-27');
  });

  it('flips exactly at local midnight (21:00 UTC in Istanbul, UTC+3)', () => {
    expect(todayInZone(new Date('2026-10-26T20:59:59Z'), 'Europe/Istanbul')).toBe('2026-10-26');
    expect(todayInZone(new Date('2026-10-26T21:00:00Z'), 'Europe/Istanbul')).toBe('2026-10-27');
  });
});

describe('assertValidTimeZone', () => {
  it('accepts IANA names and rejects unknown ones', () => {
    assertValidTimeZone('Europe/Istanbul');
    expect(() => assertValidTimeZone('Mars/Olympus_Mons')).toThrow();
  });
});
