import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AvailabilityResponse } from '../../src/modules/inventory/http/availability-response.js';
import { fixedClock } from '../support/fixtures.js';
import { book, bookingBody, cancel, LAGOS, roomTypeId } from '../support/reservation-helpers.js';
import { createTestDatabase, setBooked, type TestDatabase } from '../support/test-database.js';

let db: TestDatabase;
let app: FastifyInstance;
let standard: string;

beforeAll(async () => {
  db = await createTestDatabase({ poolSize: 20 });
  // A frozen clock never expires entries, so only invalidation can change what is served.
  app = await buildApp({ pool: db.pool, clock: fixedClock(), availabilityCacheTtlMs: 60_000 });
  await app.ready();
  standard = await roomTypeId(db.pool, LAGOS, 'standard');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

const dates = { checkIn: '2027-02-10', checkOut: '2027-02-12' };
const ask = (query: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/v1/public/${LAGOS}/availability`, query: { ...dates, adults: '2', children: '0', ...query } });
const remaining = (response: { json(): unknown }): number | undefined =>
  (response.json() as AvailabilityResponse).roomTypes.find((r) => r.code === 'standard')?.remaining;

describe('availability cache (S6, ADR-0009)', () => {
  it('serves the second identical question from memory, never from the browser cache', async () => {
    const first = await ask();
    const second = await ask();
    expect([first.headers['x-cache'], second.headers['x-cache']]).toEqual(['MISS', 'HIT']);
    expect(second.headers['cache-control']).toBe('no-store');
    expect(second.json()).toEqual(first.json());
  });

  it('a booking immediately changes what the next question sees (invalidation, not waiting for the TTL)', async () => {
    const before = await ask();
    expect(remaining(before)).toBe(20);
    expect((await book(app, LAGOS, bookingBody(standard, dates))).statusCode).toBe(201);

    const after = await ask();
    expect(after.headers['x-cache']).toBe('MISS');
    expect(remaining(after)).toBe(19);
    expect((await ask()).headers['x-cache']).toBe('HIT');
  });

  it('a cancellation gives the room back to the next question just as fast', async () => {
    const created = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-03-10', checkOut: '2027-03-12' }));
    const query = { checkIn: '2027-03-10', checkOut: '2027-03-12' };
    expect(remaining(await ask(query))).toBe(19);
    expect(remaining(await ask(query))).toBe(19); // cached

    await cancel(app, LAGOS, created.json().reservation.code, 'ayse@example.com');
    expect(remaining(await ask(query))).toBe(20);
  });

  it('the booking never trusts the cache: a stale "available" answer still ends in a clean SOLD_OUT, and heals the cache', async () => {
    const query = { checkIn: '2027-04-10', checkOut: '2027-04-11' };
    expect(remaining(await ask(query))).toBe(20); // cached: "20 left"

    // Another instance (or a direct DB change) sells everything; this instance's cache does not know.
    await setBooked(db.pool, LAGOS, 'standard', '2027-04-10', 20);
    expect(remaining(await ask(query))).toBe(20); // still stale, as designed (bounded by the TTL)

    const attempt = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-04-10', checkOut: '2027-04-11' }));
    expect(attempt.statusCode).toBe(409);
    expect(attempt.json().error.code).toBe('SOLD_OUT');

    const healed = await ask(query);
    expect(healed.headers['x-cache']).toBe('MISS'); // SOLD_OUT dropped the stale answer
    expect(remaining(healed)).toBeUndefined(); // standard is no longer offered
  });

  it('does not cache validation errors', async () => {
    const bad = { checkIn: '2020-01-01', checkOut: '2020-01-02' };
    expect((await ask(bad)).statusCode).toBe(422);
    expect((await ask(bad)).statusCode).toBe(422);
  });
});
