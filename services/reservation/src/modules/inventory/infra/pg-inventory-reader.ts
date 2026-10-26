import type { Queryable } from '../../../platform/db/queryable.js';
import type { LocalDate } from '../../../shared/local-date.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { InventoryReader } from '../application/ports.js';
import type { NightlyInventory, RoomType } from '../domain/availability.js';

interface RoomTypeRow {
  id: string;
  code: string;
  name_tr: string;
  name_en: string;
  max_guests: number;
  base_price_minor: number;
}

interface InventoryRow {
  room_type_id: string;
  stay_date: LocalDate;
  total: number;
  booked: number;
}

/**
 * Postgres adapter for the inventory read side. Every statement filters on hotel_id: a tenant
 * can only ever see its own rows, whatever the caller passes in the other arguments.
 */
export class PgInventoryReader implements InventoryReader {
  constructor(private readonly db: Queryable) {}

  async listRoomTypes(hotelId: HotelId): Promise<RoomType[]> {
    const result = await this.db.query<RoomTypeRow>(
      `SELECT id, code, name_tr, name_en, max_guests, base_price_minor
       FROM room_types
       WHERE hotel_id = $1
       ORDER BY base_price_minor, code`,
      [hotelId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: { tr: row.name_tr, en: row.name_en },
      maxGuests: row.max_guests,
      nightlyPriceMinor: row.base_price_minor,
    }));
  }

  async listNightlyInventory(
    hotelId: HotelId,
    from: LocalDate,
    toExclusive: LocalDate,
  ): Promise<NightlyInventory[]> {
    const result = await this.db.query<InventoryRow>(
      `SELECT room_type_id, stay_date, total, booked
       FROM inventory
       WHERE hotel_id = $1 AND stay_date >= $2::date AND stay_date < $3::date
       ORDER BY room_type_id, stay_date`,
      [hotelId, from, toExclusive],
    );
    return result.rows.map((row) => ({
      roomTypeId: row.room_type_id,
      date: row.stay_date,
      total: row.total,
      booked: row.booked,
    }));
  }
}
