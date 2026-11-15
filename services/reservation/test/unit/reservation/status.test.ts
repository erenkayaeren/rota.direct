import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  assertTransition,
  canTransition,
  holdsInventory,
  RESERVATION_STATUSES,
  type ReservationStatus,
} from '../../../src/modules/reservation/domain/status.js';
import { expectDomainError } from '../../support/domain-error.js';

describe('reservation state machine (S1)', () => {
  it('allows exactly the documented transitions', () => {
    const allowed = RESERVATION_STATUSES.flatMap((from) =>
      RESERVATION_STATUSES.filter((to) => canTransition(from, to)).map((to) => `${from}->${to}`),
    );
    expect(allowed.sort()).toEqual(
      [
        'PENDING->CONFIRMED',
        'PENDING->CANCELLED',
        'CONFIRMED->CHECKED_IN',
        'CONFIRMED->CANCELLED',
        'CONFIRMED->NO_SHOW',
        'CHECKED_IN->CHECKED_OUT',
      ].sort(),
    );
  });

  it.each(['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const)('%s is terminal', (status: ReservationStatus) => {
    expect(allowedTransitions(status)).toEqual([]);
  });

  it('cannot cancel a guest who is already in the hotel', () => {
    expect(canTransition('CHECKED_IN', 'CANCELLED')).toBe(false);
  });

  it('assertTransition throws a conflict error that explains what was allowed', () => {
    const error = expectDomainError(() => assertTransition('CANCELLED', 'CANCELLED'), 'INVALID_STATE_TRANSITION');
    expect(error.kind).toBe('conflict');
    expect(error.details).toEqual({ from: 'CANCELLED', to: 'CANCELLED', allowed: [] });
  });

  it('assertTransition passes for an allowed move', () => {
    expect(() => assertTransition('CONFIRMED', 'CANCELLED')).not.toThrow();
  });

  it('only cancelled and no-show reservations stop holding inventory', () => {
    expect(RESERVATION_STATUSES.filter((s) => !holdsInventory(s)).sort()).toEqual(['CANCELLED', 'NO_SHOW']);
  });
});
