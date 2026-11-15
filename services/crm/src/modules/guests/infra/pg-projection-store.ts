import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../../platform/db/transaction.js';
import type { ProjectionStore, ProjectionTx, ReservationSnapshot } from '../application/ports.js';
import { isNewerVersion, shouldReplaceProfile } from '../domain/profile.js';

class PgProjectionTx implements ProjectionTx {
  constructor(private readonly db: PoolClient) {}

  async claimEvent(eventId: string, eventType: string): Promise<boolean> {
    // A concurrent delivery of the same event waits here for the first one to finish, then conflicts.
    const result = await this.db.query(
      'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING',
      [eventId, eventType],
    );
    return result.rowCount === 1;
  }

  async upsertHotel(hotel: ReservationSnapshot['hotel']): Promise<void> {
    await this.db.query(
      `INSERT INTO hotels (id, public_key, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET public_key = EXCLUDED.public_key, name = EXCLUDED.name, updated_at = now()`,
      [hotel.id, hotel.key, hotel.name],
    );
  }

  async upsertGuest(reservation: ReservationSnapshot, email: string): Promise<string> {
    const hotelId = reservation.hotel.id;
    const { guest, consents } = reservation;
    // Serialises the "find or create" of one person. All events of a reservation share its guest's
    // email, so this lock also orders them against each other.
    await this.db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${hotelId}:${email}`]);

    const existing = await this.db.query<{ id: string; profile_as_of: Date }>(
      'SELECT id, profile_as_of FROM guests WHERE hotel_id = $1 AND email = $2 FOR UPDATE',
      [hotelId, email],
    );
    const row = existing.rows[0];
    const values = [
      guest.firstName.trim(),
      guest.lastName.trim(),
      guest.phone,
      consents.kvkkAcceptedAt,
      consents.marketing,
      consents.marketingConsentedAt,
      reservation.createdAt,
    ];

    if (row === undefined) {
      const inserted = await this.db.query<{ id: string }>(
        `INSERT INTO guests (hotel_id, email, first_name, last_name, phone, kvkk_accepted_at,
                             marketing_consent, marketing_consented_at, profile_as_of)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [hotelId, email, ...values],
      );
      return (inserted.rows[0] as { id: string }).id;
    }

    if (shouldReplaceProfile(row.profile_as_of, reservation.createdAt)) {
      await this.db.query(
        `UPDATE guests
         SET first_name = $3, last_name = $4, phone = $5, kvkk_accepted_at = $6,
             marketing_consent = $7, marketing_consented_at = $8, profile_as_of = $9, updated_at = now()
         WHERE hotel_id = $1 AND id = $2`,
        [hotelId, row.id, ...values],
      );
    }
    return row.id;
  }

  async upsertReservation(guestId: string, reservation: ReservationSnapshot, eventId: string): Promise<boolean> {
    const stored = await this.db.query<{ version: number }>(
      'SELECT version FROM guest_reservations WHERE reservation_id = $1 FOR UPDATE',
      [reservation.reservationId],
    );
    if (!isNewerVersion(stored.rows[0]?.version ?? null, reservation.version)) return false;

    await this.db.query(
      `INSERT INTO guest_reservations (
         reservation_id, hotel_id, guest_id, code, status, version, room_type_id, room_type_code,
         room_type_name_tr, room_type_name_en, check_in, check_out, nights, adults, children,
         total_price_minor, currency, booked_at, cancelled_at, last_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date, ($12::date - $11::date),
               $13, $14, $15, $16, $17, $18, $19)
       ON CONFLICT (reservation_id) DO UPDATE SET
         status = EXCLUDED.status, version = EXCLUDED.version, cancelled_at = EXCLUDED.cancelled_at,
         last_event_id = EXCLUDED.last_event_id, updated_at = now()`,
      [
        reservation.reservationId,
        reservation.hotel.id,
        guestId,
        reservation.code,
        reservation.status,
        reservation.version,
        reservation.roomType.id,
        reservation.roomType.code,
        reservation.roomType.name.tr,
        reservation.roomType.name.en,
        reservation.checkIn,
        reservation.checkOut,
        reservation.adults,
        reservation.children,
        reservation.totalPriceMinor,
        reservation.currency,
        reservation.createdAt,
        reservation.cancelledAt,
        eventId,
      ],
    );
    return true;
  }
}

export class PgProjectionStore implements ProjectionStore {
  constructor(private readonly pool: Pool) {}

  run<T>(work: (tx: ProjectionTx) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (client) => work(new PgProjectionTx(client)));
  }
}
