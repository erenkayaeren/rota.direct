import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';

export const LAGOS = 'pk_lagos_beach_demo';
export const PERI = 'pk_peri_stone_demo';

export async function roomTypeId(pool: Pool, hotelKey: string, code: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `SELECT rt.id FROM room_types rt JOIN hotels h ON h.id = rt.hotel_id
     WHERE h.public_key = $1 AND rt.code = $2`,
    [hotelKey, code],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error(`No room type ${code} for ${hotelKey}`);
  return row.id;
}

export function bookingBody(roomType: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    roomTypeId: roomType,
    checkIn: '2026-11-10',
    checkOut: '2026-11-13',
    adults: 2,
    children: 0,
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '0532 123 45 67' },
    consents: { kvkk: true, marketing: false },
    ...overrides,
  };
}

export function newKey(): string {
  return randomUUID();
}

export function book(
  app: FastifyInstance,
  hotelKey: string,
  body: unknown,
  options: { key?: string | null; origin?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.key !== null) headers['idempotency-key'] = options.key ?? newKey();
  if (options.origin) headers['origin'] = options.origin;
  return app.inject({ method: 'POST', url: `/v1/public/${hotelKey}/reservations`, headers, payload: body as object });
}

export function cancel(app: FastifyInstance, hotelKey: string, code: string, email: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/public/${hotelKey}/reservations/${code}/cancel`,
    payload: { email },
  });
}

/** `booked` of one room type on each night in [from, to). */
export async function bookedByNight(
  pool: Pool,
  hotelKey: string,
  roomTypeCode: string,
  from: string,
  to: string,
): Promise<Array<{ date: string; booked: number; total: number }>> {
  const result = await pool.query<{ date: string; booked: number; total: number }>(
    `SELECT i.stay_date AS date, i.booked, i.total
     FROM inventory i
     JOIN room_types rt ON rt.hotel_id = i.hotel_id AND rt.id = i.room_type_id
     JOIN hotels h ON h.id = i.hotel_id
     WHERE h.public_key = $1 AND rt.code = $2 AND i.stay_date >= $3::date AND i.stay_date < $4::date
     ORDER BY i.stay_date`,
    [hotelKey, roomTypeCode, from, to],
  );
  return result.rows;
}

export async function count(pool: Pool, table: string, where = 'TRUE', params: unknown[] = []): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE ${where}`, params);
  return Number(result.rows[0]?.n);
}
