import type { Queryable } from '../../../platform/db/queryable.js';
import type { LocalDate } from '../../../shared/local-date.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { InventoryStock } from '../application/ports.js';

/**
 * The only code in the system that changes `inventory.booked` (see ADR-0002).
 *
 * The overbooking guarantee is the `booked < total` condition *inside* the UPDATE. Postgres
 * locks each row it updates; a second transaction wanting the same row waits, and when the
 * first commits, re-checks the WHERE clause against the new value (READ COMMITTED behaviour).
 * So "check" and "take" are one atomic step per row, and the last room can be sold only once.
 * Construct this with the transaction's client, not the pool, so the caller can roll back.
 */
export class PgInventoryStock implements InventoryStock {
  constructor(private readonly db: Queryable) {}

  async takeNights(
    hotelId: HotelId,
    roomTypeId: string,
    checkIn: LocalDate,
    checkOut: LocalDate,
  ): Promise<number> {
    const result = await this.db.query(
      `UPDATE inventory
       SET booked = booked + 1
       WHERE hotel_id = $1 AND room_type_id = $2
         AND stay_date >= $3::date AND stay_date < $4::date
         AND booked < total`,
      [hotelId, roomTypeId, checkIn, checkOut],
    );
    return result.rowCount ?? 0;
  }

  async releaseNights(
    hotelId: HotelId,
    roomTypeId: string,
    checkIn: LocalDate,
    checkOut: LocalDate,
  ): Promise<number> {
    const result = await this.db.query(
      `UPDATE inventory
       SET booked = booked - 1
       WHERE hotel_id = $1 AND room_type_id = $2
         AND stay_date >= $3::date AND stay_date < $4::date
         AND booked > 0`,
      [hotelId, roomTypeId, checkIn, checkOut],
    );
    return result.rowCount ?? 0;
  }
}
