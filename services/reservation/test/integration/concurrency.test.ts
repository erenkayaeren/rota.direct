import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { addDays, eachNight, localDate } from '../../src/shared/local-date.js';
import { fixedClock } from '../support/fixtures.js';
import { bookedByNight, book, bookingBody, cancel, count, LAGOS, roomTypeId } from '../support/reservation-helpers.js';
import { createTestDatabase, setBooked, type TestDatabase } from '../support/test-database.js';

/**
 * M6 - the mandatory concurrency test. These tests fire real simultaneous HTTP requests
 * (app.inject) at a real Postgres. If the booking logic were "read availability, then write",
 * they would sell more rooms than exist; they pass only because the UPDATE is conditional.
 */
let db: TestDatabase;
let app: FastifyInstance;
let familySuite: string;

beforeAll(async () => {
  // 25-40 requests in flight at once, each holding a connection: the pool must be bigger than that.
  db = await createTestDatabase({ poolSize: 60 });
  app = await buildApp({ pool: db.pool, clock: fixedClock() });
  await app.ready();
  familySuite = await roomTypeId(db.pool, LAGOS, 'family-suite');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const statusCounts = (statuses: number[]): Record<number, number> =>
  statuses.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});

describe('overbooking protection under concurrency (M6)', () => {
  it('sells the LAST room exactly once when 15 guests click "book" at the same moment', async () => {
    // 5 family suites exist; 4 are already sold on each night of the stay, so exactly 1 is left.
    for (const night of eachNight(localDate('2026-12-01'), localDate('2026-12-04'))) {
      await setBooked(db.pool, LAGOS, 'family-suite', night, 4);
    }
    const body = bookingBody(familySuite, { checkIn: '2026-12-01', checkOut: '2026-12-04', adults: 2 });

    const responses = await Promise.all(Array.from({ length: 15 }, () => book(app, LAGOS, body)));

    expect(statusCounts(responses.map((r) => r.statusCode))).toEqual({ 201: 1, 409: 14 });
    for (const loser of responses.filter((r) => r.statusCode === 409)) {
      expect(loser.json()).toMatchObject({ error: { code: 'SOLD_OUT' } });
    }
    const nights = await bookedByNight(db.pool, LAGOS, 'family-suite', '2026-12-01', '2026-12-04');
    expect(nights.map((n) => n.booked)).toEqual([5, 5, 5]);
    expect(await count(db.pool, 'reservations', `check_in = DATE '2026-12-01'`)).toBe(1);
    expect(await count(db.pool, 'outbox_events', `event_type = 'reservation.created'`)).toBe(1);
  });

  it('never exceeds the stock: 25 simultaneous requests for 5 family suites produce exactly 5 bookings', async () => {
    const body = bookingBody(familySuite, { checkIn: '2026-12-10', checkOut: '2026-12-12' });

    const responses = await Promise.all(Array.from({ length: 25 }, () => book(app, LAGOS, body)));

    expect(statusCounts(responses.map((r) => r.statusCode))).toEqual({ 201: 5, 409: 20 });
    const codes = responses.filter((r) => r.statusCode === 201).map((r) => r.json().reservation.code as string);
    expect(new Set(codes).size).toBe(5); // five different booking codes
    const nights = await bookedByNight(db.pool, LAGOS, 'family-suite', '2026-12-10', '2026-12-12');
    expect(nights.map((n) => n.booked)).toEqual([5, 5]);
  });

  it('keeps every night consistent when overlapping stays race (no partial stays, no negative or excess stock)', async () => {
    // Six-night window, 5 suites, 40 requests for random sub-ranges of it.
    const windowStart = localDate('2027-01-10');
    const windowEnd = addDays(windowStart, 6);
    let seed = 20261026; // deterministic pseudo-random ranges: a failure can be reproduced
    const random = (max: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    const requests = Array.from({ length: 40 }, () => {
      const start = random(5);
      const nights = 1 + random(Math.min(3, 6 - start));
      return bookingBody(familySuite, {
        checkIn: addDays(windowStart, start),
        checkOut: addDays(windowStart, start + nights),
      });
    });

    const responses = await Promise.all(requests.map((body) => book(app, LAGOS, body)));

    // Only "created" or "sold out": a deadlock or constraint error must never reach the client.
    const outcomes = statusCounts(responses.map((r) => r.statusCode));
    expect(Object.keys(outcomes).filter((status) => status !== '201' && status !== '409')).toEqual([]);

    // The invariant: for every night, booked == number of live reservations covering it, and booked <= total.
    const inventory = await bookedByNight(db.pool, LAGOS, 'family-suite', windowStart, windowEnd);
    for (const row of inventory) {
      const covering = await count(
        db.pool,
        'reservations',
        `status = 'CONFIRMED' AND room_type_id = $1 AND check_in <= $2::date AND check_out > $2::date`,
        [familySuite, row.date],
      );
      expect(row.booked).toBe(covering);
      expect(row.booked).toBeLessThanOrEqual(row.total);
    }
    expect(responses.some((r) => r.statusCode === 201)).toBe(true);
  });

  it('releases rooms exactly once when the same reservation is cancelled 6 times at once', async () => {
    const created = await book(app, LAGOS, bookingBody(familySuite, { checkIn: '2027-02-01', checkOut: '2027-02-03' }));
    expect(created.statusCode).toBe(201);
    const code = created.json().reservation.code as string;
    // a second guest holds the other nights' stock, so a double release would show as booked = 0
    await book(app, LAGOS, bookingBody(familySuite, { checkIn: '2027-02-01', checkOut: '2027-02-03' }));

    const responses = await Promise.all(Array.from({ length: 6 }, () => cancel(app, LAGOS, code, 'ayse@example.com')));

    expect(statusCounts(responses.map((r) => r.statusCode))).toEqual({ 200: 1, 409: 5 });
    const nights = await bookedByNight(db.pool, LAGOS, 'family-suite', '2027-02-01', '2027-02-03');
    expect(nights.map((n) => n.booked)).toEqual([1, 1]);
  });
});
