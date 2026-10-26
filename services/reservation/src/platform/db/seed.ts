import type { Pool } from 'pg';
import { assertNormalizedOrigin } from '../../modules/tenancy/domain/hotel.js';
import { assertValidTimeZone } from '../../shared/local-date.js';
import { DEMO_HOTELS, type SeedHotel } from './seed-data.js';

/**
 * Idempotent upsert of hotels and room types. Safe to run on every start: it never touches
 * the inventory table, so existing bookings are unaffected.
 */
export async function seedDemoData(pool: Pool, hotels: readonly SeedHotel[] = DEMO_HOTELS): Promise<void> {
  for (const hotel of hotels) {
    assertValidTimeZone(hotel.timezone);
    hotel.allowedOrigins.forEach(assertNormalizedOrigin);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const hotel of hotels) {
      const result = await client.query<{ id: string }>(
        `INSERT INTO hotels (public_key, name, city, timezone, currency, allowed_origins)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (public_key) DO UPDATE SET
           name = EXCLUDED.name,
           city = EXCLUDED.city,
           timezone = EXCLUDED.timezone,
           currency = EXCLUDED.currency,
           allowed_origins = EXCLUDED.allowed_origins
         RETURNING id`,
        [hotel.publicKey, hotel.name, hotel.city, hotel.timezone, hotel.currency, hotel.allowedOrigins],
      );
      const hotelId = result.rows[0]?.id;
      if (hotelId === undefined) throw new Error(`Failed to upsert hotel ${hotel.publicKey}`);

      for (const roomType of hotel.roomTypes) {
        await client.query(
          `INSERT INTO room_types
             (hotel_id, code, name_tr, name_en, total_rooms, max_guests, base_price_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (hotel_id, code) DO UPDATE SET
             name_tr = EXCLUDED.name_tr,
             name_en = EXCLUDED.name_en,
             total_rooms = EXCLUDED.total_rooms,
             max_guests = EXCLUDED.max_guests,
             base_price_minor = EXCLUDED.base_price_minor`,
          [
            hotelId,
            roomType.code,
            roomType.nameTr,
            roomType.nameEn,
            roomType.totalRooms,
            roomType.maxGuests,
            roomType.nightlyPriceMinor,
          ],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
