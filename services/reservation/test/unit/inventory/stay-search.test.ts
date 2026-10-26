import { describe, expect, it } from 'vitest';
import { createStaySearch, STAY_LIMITS, type StaySearchInput } from '../../../src/modules/inventory/domain/stay-search.js';
import { addDays, localDate } from '../../../src/shared/local-date.js';
import { expectDomainError } from '../../support/domain-error.js';
import { TODAY } from '../../support/fixtures.js';

const valid: StaySearchInput = {
  checkIn: localDate('2026-11-01'),
  checkOut: localDate('2026-11-04'),
  adults: 2,
  children: 0,
};

function search(overrides: Partial<StaySearchInput>) {
  return () => createStaySearch({ ...valid, ...overrides }, TODAY);
}

describe('createStaySearch', () => {
  it('builds a validated search with nights and total guests', () => {
    const stay = createStaySearch({ ...valid, adults: 2, children: 1 }, TODAY);
    expect(stay.nights).toBe(3);
    expect(stay.guests).toBe(3);
    expect(stay.checkIn).toBe('2026-11-01');
  });

  describe('dates', () => {
    it('allows checking in today but not yesterday', () => {
      const tomorrow = addDays(TODAY, 1);
      expect(createStaySearch({ ...valid, checkIn: TODAY, checkOut: tomorrow }, TODAY).nights).toBe(1);
      expectDomainError(search({ checkIn: addDays(TODAY, -1), checkOut: TODAY }), 'CHECK_IN_IN_PAST');
    });

    it('rejects a check-out that is not after check-in', () => {
      expectDomainError(search({ checkOut: valid.checkIn }), 'INVALID_DATE_RANGE');
      expectDomainError(search({ checkIn: valid.checkOut, checkOut: valid.checkIn }), 'INVALID_DATE_RANGE');
    });

    it(`allows ${STAY_LIMITS.maxNights} nights and rejects one more`, () => {
      const checkIn = addDays(TODAY, 10);
      const ok = createStaySearch(
        { ...valid, checkIn, checkOut: addDays(checkIn, STAY_LIMITS.maxNights) },
        TODAY,
      );
      expect(ok.nights).toBe(STAY_LIMITS.maxNights);

      const error = expectDomainError(
        search({ checkIn, checkOut: addDays(checkIn, STAY_LIMITS.maxNights + 1) }),
        'STAY_TOO_LONG',
      );
      expect(error.details).toEqual({ maxNights: STAY_LIMITS.maxNights });
    });

    it('requires the stay to end inside the booking window', () => {
      const lastCheckOut = addDays(TODAY, STAY_LIMITS.bookingWindowDays);
      const checkIn = addDays(lastCheckOut, -5);
      expect(createStaySearch({ ...valid, checkIn, checkOut: lastCheckOut }, TODAY).nights).toBe(5);
      expectDomainError(
        search({ checkIn, checkOut: addDays(lastCheckOut, 1) }),
        'OUTSIDE_BOOKING_WINDOW',
      );
    });
  });

  describe('guests', () => {
    it('needs at least one adult', () => {
      expectDomainError(search({ adults: 0 }), 'INVALID_GUEST_COUNT');
    });

    it('rejects negative, fractional and oversized party counts', () => {
      expectDomainError(search({ children: -1 }), 'INVALID_GUEST_COUNT');
      expectDomainError(search({ adults: 1.5 }), 'INVALID_GUEST_COUNT');
      expectDomainError(search({ adults: STAY_LIMITS.maxAdults + 1 }), 'INVALID_GUEST_COUNT');
      expectDomainError(search({ children: STAY_LIMITS.maxChildren + 1 }), 'INVALID_GUEST_COUNT');
    });

    it('accepts one adult and no children', () => {
      expect(createStaySearch({ ...valid, adults: 1, children: 0 }, TODAY).guests).toBe(1);
    });
  });
});
