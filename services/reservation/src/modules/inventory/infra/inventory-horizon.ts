import type { Queryable } from '../../../platform/db/queryable.js';
import { addDays, todayInZone, type LocalDate } from '../../../shared/local-date.js';

/**
 * How many days of inventory rows are materialised ahead of today. Must stay comfortably above
 * the booking window (STAY_LIMITS.bookingWindowDays) so a guest can never search a night that
 * has no row yet; the margin also absorbs hotels whose "today" differs from UTC's.
 */
export const INVENTORY_HORIZON_DAYS = 400;

/** First date to materialise: one day before UTC today covers every time zone's "today". */
export function horizonStart(now: Date): LocalDate {
  return addDays(todayInZone(now, 'UTC'), -1);
}

/**
 * Creates the missing inventory rows for every room type from `from` through `from + days`.
 * Idempotent (existing rows, and the bookings counted on them, are never touched), so it is
 * safe to run at every start, every few hours, and from several replicas at once.
 *
 * @returns the number of rows inserted
 */
export async function ensureInventoryHorizon(
  db: Queryable,
  from: LocalDate,
  days: number = INVENTORY_HORIZON_DAYS,
): Promise<number> {
  const result = await db.query(
    `INSERT INTO inventory (hotel_id, room_type_id, stay_date, total)
     SELECT rt.hotel_id, rt.id, $1::date + g, rt.total_rooms
     FROM room_types rt
     CROSS JOIN generate_series(0, $2::int) AS g
     ON CONFLICT (hotel_id, room_type_id, stay_date) DO NOTHING`,
    [from, days],
  );
  return result.rowCount ?? 0;
}
