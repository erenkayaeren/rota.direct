import type { Queryable } from '../../../platform/db/queryable.js';
import type { LocalDate } from '../../../shared/local-date.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { ReservationRepository } from '../application/ports.js';
import type { NewReservation, Reservation } from '../domain/reservation.js';
import type { ReservationStatus } from '../domain/status.js';

interface ReservationRow {
  id: string;
  hotel_id: string;
  room_type_id: string;
  code: string;
  status: ReservationStatus;
  check_in: LocalDate;
  check_out: LocalDate;
  adults: number;
  children: number;
  total_price_minor: number;
  currency: string;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  kvkk_accepted_at: Date;
  marketing_consented_at: Date | null;
  version: number;
  created_at: Date;
  cancelled_at: Date | null;
}

const COLUMNS = `id, hotel_id, room_type_id, code, status, check_in, check_out, adults, children,
  total_price_minor, currency, guest_first_name, guest_last_name, guest_email, guest_phone,
  kvkk_accepted_at, marketing_consented_at, version, created_at, cancelled_at`;

function toReservation(row: ReservationRow): Reservation {
  return {
    id: row.id,
    hotelId: row.hotel_id,
    roomTypeId: row.room_type_id,
    code: row.code,
    status: row.status,
    checkIn: row.check_in,
    checkOut: row.check_out,
    adults: row.adults,
    children: row.children,
    totalPriceMinor: row.total_price_minor,
    currency: row.currency,
    guest: {
      firstName: row.guest_first_name,
      lastName: row.guest_last_name,
      email: row.guest_email,
      phone: row.guest_phone,
    },
    kvkkAcceptedAt: row.kvkk_accepted_at,
    marketingConsentedAt: row.marketing_consented_at,
    version: row.version,
    createdAt: row.created_at,
    cancelledAt: row.cancelled_at,
  };
}

/** Every statement filters on hotel_id; a code or id from another hotel simply does not exist here. */
export class PgReservationRepository implements ReservationRepository {
  constructor(private readonly db: Queryable) {}

  async insert(reservation: NewReservation): Promise<Reservation | null> {
    const result = await this.db.query<ReservationRow>(
      `INSERT INTO reservations (
         hotel_id, room_type_id, code, status, check_in, check_out, adults, children,
         total_price_minor, currency, guest_first_name, guest_last_name, guest_email, guest_phone,
         kvkk_accepted_at, marketing_consent, marketing_consented_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               $16::timestamptz IS NOT NULL, $16, $17, $17)
       ON CONFLICT (hotel_id, code) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        reservation.hotelId,
        reservation.roomTypeId,
        reservation.code,
        reservation.status,
        reservation.checkIn,
        reservation.checkOut,
        reservation.adults,
        reservation.children,
        reservation.totalPriceMinor,
        reservation.currency,
        reservation.guest.firstName,
        reservation.guest.lastName,
        reservation.guest.email,
        reservation.guest.phone,
        reservation.kvkkAcceptedAt,
        reservation.marketingConsentedAt,
        reservation.createdAt,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? null : toReservation(row);
  }

  async findByCodeForUpdate(hotelId: HotelId, code: string): Promise<Reservation | null> {
    const result = await this.db.query<ReservationRow>(
      `SELECT ${COLUMNS} FROM reservations WHERE hotel_id = $1 AND code = $2 FOR UPDATE`,
      [hotelId, code],
    );
    const row = result.rows[0];
    return row === undefined ? null : toReservation(row);
  }

  async markCancelled(hotelId: HotelId, id: string, expectedVersion: number, now: Date): Promise<Reservation> {
    const result = await this.db.query<ReservationRow>(
      `UPDATE reservations
       SET status = 'CANCELLED', version = version + 1, cancelled_at = $4, updated_at = $4
       WHERE hotel_id = $1 AND id = $2 AND version = $3
       RETURNING ${COLUMNS}`,
      [hotelId, id, expectedVersion, now],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Reservation ${id} changed while it was locked`);
    return toReservation(row);
  }
}
