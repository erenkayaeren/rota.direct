import { parseEvent } from './event-contract.js';
import type { ProjectionStore } from './ports.js';
import { normalizeEmail } from '../domain/email.js';

export type ProjectionOutcome = 'applied' | 'duplicate' | 'stale' | 'ignored';

/**
 * M10 + M11: turns a reservation event into guest profile data. The CRM learns about
 * reservations ONLY through this use case (ADR-0001, ADR-0007).
 *
 * One transaction per event:
 *   1. claim the event id (a redelivery stops here: idempotent consumer);
 *   2. remember the hotel;
 *   3. find the guest by normalized email, or create it (profile fields follow the newest booking);
 *   4. store the reservation snapshot unless a newer version is already there.
 * Steps 1-4 commit together or not at all, so a crash in the middle just means a redelivery.
 */
export class ProjectReservationEvent {
  constructor(private readonly store: ProjectionStore) {}

  /** @throws PoisonMessageError if `raw` breaks the event contract */
  async handle(raw: unknown): Promise<ProjectionOutcome> {
    const parsed = parseEvent(raw);
    if (parsed.kind === 'ignored') return 'ignored';
    const { event } = parsed;

    return this.store.run(async (tx) => {
      if (!(await tx.claimEvent(event.eventId, event.type))) return 'duplicate';

      const reservation = event.reservation;
      await tx.upsertHotel(reservation.hotel);
      const guestId = await tx.upsertGuest(reservation, normalizeEmail(reservation.guest.email));
      const applied = await tx.upsertReservation(guestId, reservation, event.eventId);
      return applied ? 'applied' : 'stale';
    });
  }
}
