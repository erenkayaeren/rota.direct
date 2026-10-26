import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AvailabilityResponse } from '../../src/modules/inventory/http/availability-response.js';
import { fixedClock, LAGOS_ORIGIN, PERI_ORIGIN } from '../support/fixtures.js';
import { createTestDatabase, setBooked, type TestDatabase } from '../support/test-database.js';

const LAGOS = 'pk_lagos_beach_demo';
const PERI = 'pk_peri_stone_demo';

let db: TestDatabase;
let app: FastifyInstance;

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ pool: db.pool, clock: fixedClock() });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

function search(hotelKey: string, query: Record<string, string>, origin?: string) {
  return app.inject({
    method: 'GET',
    url: `/v1/public/${hotelKey}/availability`,
    query,
    headers: origin ? { origin } : {},
  });
}

const stay = (checkIn: string, checkOut: string, adults = '2', children = '0') => ({
  checkIn,
  checkOut,
  adults,
  children,
});

function offers(response: { json(): unknown }): string[] {
  return (response.json() as AvailabilityResponse).roomTypes.map((r) => `${r.code}:${r.remaining}`);
}

describe('GET /v1/public/:hotelKey/availability', () => {
  it('returns bookable room types with prices and rooms left (M3, M5)', async () => {
    const response = await search(LAGOS, stay('2026-11-01', '2026-11-04'));

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json() as AvailabilityResponse;
    expect(body.stay).toEqual({ checkIn: '2026-11-01', checkOut: '2026-11-04', nights: 3, adults: 2, children: 0 });
    expect(body.roomTypes.map((r) => r.code)).toEqual(['standard', 'deluxe-sea-view', 'family-suite']);
    expect(body.roomTypes[0]).toMatchObject({
      name: { tr: 'Standart', en: 'Standard' },
      maxGuests: 2,
      remaining: 20,
      nightlyPrice: { amountMinor: 320_000, currency: 'TRY' },
      totalPrice: { amountMinor: 960_000, currency: 'TRY' },
    });
  });

  it('only offers rooms that fit the party (children count) and rejects parties no room fits', async () => {
    expect(offers(await search(LAGOS, stay('2026-11-01', '2026-11-04', '2', '1')))).toEqual(['deluxe-sea-view:15', 'family-suite:5']);
    expect(offers(await search(LAGOS, stay('2026-11-01', '2026-11-04', '3', '1')))).toEqual(['family-suite:5']);

    const tooMany = await search(LAGOS, stay('2026-11-01', '2026-11-04', '4', '1'));
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json()).toMatchObject({ error: { code: 'CAPACITY_EXCEEDED' } });
  });

  it('reflects inventory night by night: min over nights, sold-out night removes the type, check-out night is ignored', async () => {
    // Dedicated dates (5-8 December) so this test does not interfere with the others.
    await setBooked(db.pool, LAGOS, 'standard', '2026-12-06', 17);
    expect(offers(await search(LAGOS, stay('2026-12-05', '2026-12-08')))[0]).toBe('standard:3');

    await setBooked(db.pool, LAGOS, 'standard', '2026-12-07', 20);
    expect(offers(await search(LAGOS, stay('2026-12-05', '2026-12-08')))).toEqual(['deluxe-sea-view:15', 'family-suite:5']);

    // Sold out only on the check-out date: that night is not part of the stay.
    await setBooked(db.pool, LAGOS, 'deluxe-sea-view', '2026-12-08', 15);
    expect(offers(await search(LAGOS, stay('2026-12-05', '2026-12-08')))).toContain('deluxe-sea-view:15');
  });

  it('validates the search (M2)', async () => {
    const cases: Array<[Record<string, string>, number, string]> = [
      [stay('2026-10-25', '2026-10-27'), 422, 'CHECK_IN_IN_PAST'],
      [stay('2026-11-04', '2026-11-01'), 422, 'INVALID_DATE_RANGE'],
      [stay('2026-11-01', '2026-11-01'), 422, 'INVALID_DATE_RANGE'],
      [stay('2026-11-01', '2026-12-15'), 422, 'STAY_TOO_LONG'],
      [stay('2026-11-01', '2026-11-04', '0'), 422, 'INVALID_GUEST_COUNT'],
      [stay('2026-02-30', '2026-11-04'), 400, 'INVALID_REQUEST'],
      [{ checkIn: '2026-11-01', checkOut: '2026-11-04' }, 400, 'INVALID_REQUEST'],
      [stay('2026-11-01', '2026-11-04', 'two'), 400, 'INVALID_REQUEST'],
    ];
    for (const [query, status, code] of cases) {
      const response = await search(LAGOS, query);
      expect([JSON.stringify(query), response.statusCode]).toEqual([JSON.stringify(query), status]);
      expect(response.json()).toMatchObject({ error: { code } });
    }
  });

  it('answers 404 with the standard error shape for an unknown hotel key and an unknown route', async () => {
    const unknownHotel = await search('pk_no_such_hotel', stay('2026-11-01', '2026-11-04'));
    expect(unknownHotel.statusCode).toBe(404);
    expect(unknownHotel.json()).toMatchObject({ error: { code: 'HOTEL_NOT_FOUND' } });

    const unknownRoute = await app.inject({ method: 'GET', url: '/nope' });
    expect(unknownRoute.statusCode).toBe(404);
    expect(unknownRoute.json()).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
  });
});

describe('tenant isolation (M9)', () => {
  it("each key sees only its own hotel's room types", async () => {
    const lagos = (await search(LAGOS, stay('2026-11-10', '2026-11-12'))).json() as AvailabilityResponse;
    const peri = (await search(PERI, stay('2026-11-10', '2026-11-12'))).json() as AvailabilityResponse;

    expect(lagos.roomTypes.map((r) => r.code)).toEqual(['standard', 'deluxe-sea-view', 'family-suite']);
    expect(peri.roomTypes.map((r) => r.code)).toEqual(['cave-room', 'terrace-suite']);

    const lagosIds = new Set(lagos.roomTypes.map((r) => r.id));
    expect(peri.roomTypes.some((r) => lagosIds.has(r.id))).toBe(false);
  });

  it("one hotel's bookings never change another hotel's availability", async () => {
    const before = offers(await search(LAGOS, stay('2026-11-20', '2026-11-22')));
    await setBooked(db.pool, PERI, 'cave-room', '2026-11-20', 8);
    await setBooked(db.pool, PERI, 'cave-room', '2026-11-21', 8);

    expect(offers(await search(LAGOS, stay('2026-11-20', '2026-11-22')))).toEqual(before);
    expect(offers(await search(PERI, stay('2026-11-20', '2026-11-22')))).toEqual(['terrace-suite:2']);
  });
});

describe('per-hotel CORS', () => {
  const query = stay('2026-11-01', '2026-11-04');

  it("echoes the origin when it is on the hotel's allow-list", async () => {
    const response = await search(LAGOS, query, LAGOS_ORIGIN);
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(LAGOS_ORIGIN);
    expect(String(response.headers['vary'])).toContain('Origin');
  });

  it('also allows the browser to read business errors (422 carries the CORS header)', async () => {
    const response = await search(LAGOS, stay('2026-10-25', '2026-10-27'), LAGOS_ORIGIN);
    expect(response.statusCode).toBe(422);
    expect(response.headers['access-control-allow-origin']).toBe(LAGOS_ORIGIN);
  });

  it("rejects an origin that is not the hotel's own, including another tenant's origin", async () => {
    for (const origin of ['https://evil.example', PERI_ORIGIN]) {
      const response = await search(LAGOS, query, origin);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'ORIGIN_NOT_ALLOWED' } });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('does not apply CORS to requests without an Origin header', async () => {
    const response = await search(LAGOS, query);
    expect(response.statusCode).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight per tenant, advertising the Idempotency-Key header', async () => {
    const preflight = (hotelKey: string, origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: `/v1/public/${hotelKey}/reservations`,
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,idempotency-key',
        },
      });

    const allowed = await preflight(LAGOS, LAGOS_ORIGIN);
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(LAGOS_ORIGIN);
    expect(String(allowed.headers['access-control-allow-headers'])).toContain('Idempotency-Key');
    expect(String(allowed.headers['access-control-allow-methods'])).toContain('POST');

    expect((await preflight(LAGOS, PERI_ORIGIN)).statusCode).toBe(403);
    expect((await preflight('pk_no_such_hotel', LAGOS_ORIGIN)).statusCode).toBe(404);
  });
});

describe('health endpoints', () => {
  it('reports liveness and readiness', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
  });

  it('reports not-ready (503) when the database is unreachable', async () => {
    const brokenPool = {
      query: async () => {
        throw new Error('database down');
      },
    } as unknown as Pool;
    const broken = await buildApp({ pool: brokenPool });
    const response = await broken.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    await broken.close();
  });
});
