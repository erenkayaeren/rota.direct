import { describe, expect, it } from 'vitest';
import { parseAvailabilityQuery } from '../../../src/modules/inventory/http/availability-query.js';

const valid = { checkIn: '2026-11-01', checkOut: '2026-11-04', adults: '2', children: '1' };

describe('parseAvailabilityQuery', () => {
  it('parses dates and counts from query-string strings', () => {
    expect(parseAvailabilityQuery(valid)).toEqual({
      checkIn: '2026-11-01',
      checkOut: '2026-11-04',
      adults: 2,
      children: 1,
    });
  });

  it('defaults children to 0', () => {
    expect(parseAvailabilityQuery({ ...valid, children: undefined }).children).toBe(0);
  });

  it('rejects missing required parameters', () => {
    expect(() => parseAvailabilityQuery({ checkIn: valid.checkIn, checkOut: valid.checkOut })).toThrow();
    expect(() => parseAvailabilityQuery({ checkOut: valid.checkOut, adults: '2' })).toThrow();
  });

  it('rejects impossible or badly formatted dates', () => {
    for (const checkIn of ['2026-02-30', '01-11-2026', '2026-11-1', 'tomorrow', '']) {
      expect(() => parseAvailabilityQuery({ ...valid, checkIn })).toThrow();
    }
  });

  it('rejects counts that are not plain non-negative integers instead of coercing them', () => {
    for (const adults of ['', '-1', '1.5', '1e1', 'two', ' 2']) {
      expect(() => parseAvailabilityQuery({ ...valid, adults })).toThrow();
    }
  });

  it('rejects repeated query parameters (arrays)', () => {
    expect(() => parseAvailabilityQuery({ ...valid, adults: ['1', '2'] })).toThrow();
  });
});
