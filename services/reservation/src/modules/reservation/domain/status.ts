import { DomainError } from '../../../shared/errors.js';

export const RESERVATION_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'CANCELLED',
  'NO_SHOW',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * S1 - the reservation life cycle as data. Anything not listed is forbidden, so adding a
 * status forces a decision about where it can come from and go to. CHECKED_OUT, CANCELLED
 * and NO_SHOW are terminal.
 *
 * Bookings made through the widget are created directly as CONFIRMED (payment happens at the
 * hotel). PENDING exists for flows that need a confirmation step (e.g. online payment later).
 */
const ALLOWED: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['CHECKED_OUT'],
  CHECKED_OUT: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitions(from: ReservationStatus): readonly ReservationStatus[] {
  return ALLOWED[from];
}

/** Whether a reservation in this status still occupies inventory. */
export function holdsInventory(status: ReservationStatus): boolean {
  return status === 'PENDING' || status === 'CONFIRMED' || status === 'CHECKED_IN' || status === 'CHECKED_OUT';
}

/** @throws DomainError INVALID_STATE_TRANSITION (409): the reservation is not in a state that allows it. */
export function assertTransition(from: ReservationStatus, to: ReservationStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainError(
      'INVALID_STATE_TRANSITION',
      `A reservation that is ${from} cannot become ${to}.`,
      'conflict',
      { from, to, allowed: allowedTransitions(from) },
    );
  }
}
