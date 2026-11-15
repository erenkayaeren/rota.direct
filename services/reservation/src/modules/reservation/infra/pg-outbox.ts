import type { Queryable } from '../../../platform/db/queryable.js';
import type { OutboxWriter } from '../application/ports.js';
import type { ReservationEvent } from '../domain/events.js';
import type { Reservation } from '../domain/reservation.js';

/**
 * Transactional outbox (ADR-0001): the event row is committed together with the state change,
 * so "reservation exists" and "event will be published" can never disagree. A relay
 * reads unpublished rows in `seq` order and sends them to the broker, at-least-once.
 * UNIQUE (aggregate, version) makes writing the same change twice impossible.
 */
export class PgOutbox implements OutboxWriter {
  constructor(private readonly db: Queryable) {}

  async append(reservation: Reservation, event: ReservationEvent): Promise<void> {
    await this.db.query(
      `INSERT INTO outbox_events
         (hotel_id, aggregate_type, aggregate_id, aggregate_version, event_type, payload)
       VALUES ($1, 'reservation', $2, $3, $4, $5::jsonb)`,
      [reservation.hotelId, reservation.id, reservation.version, event.type, JSON.stringify(event.payload)],
    );
  }
}
