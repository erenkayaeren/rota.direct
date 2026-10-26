import { DomainError } from '../../../shared/errors.js';
import { addDays, diffDays, type LocalDate } from '../../../shared/local-date.js';

/** Business limits of a stay search. Public so the widget and the docs can quote them. */
export const STAY_LIMITS = Object.freeze({
  maxNights: 30,
  /** A stay must end within this many days from today. */
  bookingWindowDays: 365,
  maxAdults: 10,
  maxChildren: 10,
});

export interface StaySearchInput {
  checkIn: LocalDate;
  checkOut: LocalDate;
  adults: number;
  children: number;
}

/** A validated stay request. Can only be built through {@link createStaySearch}. */
export interface StaySearch {
  readonly checkIn: LocalDate;
  readonly checkOut: LocalDate;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  /** Adults plus children. Children count toward room capacity (conservative assumption). */
  readonly guests: number;
}

function violation(code: string, message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError(code, message, 'rule_violation', details);
}

/**
 * Applies the date and guest rules of M2. `today` is the current date in the hotel's own
 * time zone (not the server's), so a guest in Antalya at 01:30 on the 27th cannot book the 26th.
 */
export function createStaySearch(input: StaySearchInput, today: LocalDate): StaySearch {
  const { checkIn, checkOut, adults, children } = input;

  if (checkIn < today) {
    throw violation('CHECK_IN_IN_PAST', 'Check-in date cannot be in the past.', { today });
  }
  if (checkOut <= checkIn) {
    throw violation('INVALID_DATE_RANGE', 'Check-out must be after check-in.');
  }
  const nights = diffDays(checkIn, checkOut);
  if (nights > STAY_LIMITS.maxNights) {
    throw violation('STAY_TOO_LONG', `A stay can be at most ${STAY_LIMITS.maxNights} nights.`, {
      maxNights: STAY_LIMITS.maxNights,
    });
  }
  const lastBookableCheckOut = addDays(today, STAY_LIMITS.bookingWindowDays);
  if (checkOut > lastBookableCheckOut) {
    throw violation('OUTSIDE_BOOKING_WINDOW', 'Dates are too far in the future to book.', {
      lastBookableCheckOut,
    });
  }

  if (!Number.isInteger(adults) || adults < 1 || adults > STAY_LIMITS.maxAdults) {
    throw violation('INVALID_GUEST_COUNT', `Adults must be between 1 and ${STAY_LIMITS.maxAdults}.`, {
      field: 'adults',
      min: 1,
      max: STAY_LIMITS.maxAdults,
    });
  }
  if (!Number.isInteger(children) || children < 0 || children > STAY_LIMITS.maxChildren) {
    throw violation(
      'INVALID_GUEST_COUNT',
      `Children must be between 0 and ${STAY_LIMITS.maxChildren}.`,
      { field: 'children', min: 0, max: STAY_LIMITS.maxChildren },
    );
  }

  return { checkIn, checkOut, nights, adults, children, guests: adults + children };
}
