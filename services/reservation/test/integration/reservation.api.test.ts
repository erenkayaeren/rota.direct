import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { AvailabilityResponse } from '../../src/modules/inventory/http/availability-response.js';
import { fixedClock, LAGOS_ORIGIN, PERI_ORIGIN } from '../support/fixtures.js';
import {
  book,
  bookedByNight,
  bookingBody,
  cancel,
  count,
  LAGOS,
  newKey,
  PERI,
  roomTypeId,
} from '../support/reservation-helpers.js';
import { createTestDatabase, setBooked, type TestDatabase } from '../support/test-database.js';

let db: TestDatabase;
let app: FastifyInstance;
let standard: string;
let caveRoom: string;

beforeAll(async () => {
  db = await createTestDatabase({ poolSize: 20 });
  app = await buildApp({ pool: db.pool, clock: fixedClock() });
  await app.ready();
  standard = await roomTypeId(db.pool, LAGOS, 'standard');
  caveRoom = await roomTypeId(db.pool, PERI, 'cave-room');
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('POST /v1/public/:hotelKey/reservations (M6)', () => {
  it('creates a confirmed reservation, prices it, and takes one room on each night', async () => {
    const before = await bookedByNight(db.pool, LAGOS, 'standard', '2026-11-10', '2026-11-13');
    const response = await book(app, LAGOS, bookingBody(standard));

    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['idempotent-replayed']).toBeUndefined();
    const { reservation } = response.json();
    expect(reservation).toMatchObject({
      status: 'CONFIRMED',
      checkIn: '2026-11-10',
      checkOut: '2026-11-13',
      nights: 3,
      adults: 2,
      totalPriceMinor: 960_000,
      currency: 'TRY',
      roomType: { code: 'standard', name: { tr: 'Standart', en: 'Standard' } },
      guest: { firstName: 'Ayşe', email: 'ayse@example.com', phone: '+905321234567' },
      marketingConsent: false,
      cancelledAt: null,
    });
    expect(reservation.code).toMatch(/^RT-[A-HJ-NP-Z2-9]{8}$/);

    const after = await bookedByNight(db.pool, LAGOS, 'standard', '2026-11-10', '2026-11-13');
    expect(after.map((n) => n.booked)).toEqual(before.map((n) => n.booked + 1));
    // the check-out night is NOT taken
    const checkOutNight = await bookedByNight(db.pool, LAGOS, 'standard', '2026-11-13', '2026-11-14');
    expect(checkOutNight[0]?.booked).toBe(0);
  });

  it('lowers what the availability endpoint reports', async () => {
    await book(app, LAGOS, bookingBody(standard, { checkIn: '2026-11-20', checkOut: '2026-11-22' }));
    const availability = await app.inject({
      method: 'GET',
      url: `/v1/public/${LAGOS}/availability`,
      query: { checkIn: '2026-11-20', checkOut: '2026-11-22', adults: '2', children: '0' },
    });
    const standardOffer = (availability.json() as AvailabilityResponse).roomTypes.find((r) => r.code === 'standard');
    expect(standardOffer?.remaining).toBe(19);
  });

  it('stores the KVKK acknowledgement and the separate marketing consent with timestamps', async () => {
    const withMarketing = await book(
      app,
      LAGOS,
      bookingBody(standard, { checkIn: '2026-11-25', checkOut: '2026-11-26', consents: { kvkk: true, marketing: true } }),
    );
    const without = await book(
      app,
      LAGOS,
      bookingBody(standard, { checkIn: '2026-11-25', checkOut: '2026-11-26', consents: { kvkk: true } }),
    );
    const rows = await db.pool.query<{ code: string; marketing_consent: boolean; marketing_consented_at: Date | null; kvkk_accepted_at: Date }>(
      `SELECT code, marketing_consent, marketing_consented_at, kvkk_accepted_at FROM reservations WHERE code = ANY($1)`,
      [[withMarketing.json().reservation.code, without.json().reservation.code]],
    );
    const byCode = new Map(rows.rows.map((r) => [r.code, r]));
    const yes = byCode.get(withMarketing.json().reservation.code);
    const no = byCode.get(without.json().reservation.code);
    expect(yes?.marketing_consent).toBe(true);
    expect(yes?.marketing_consented_at?.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(yes?.kvkk_accepted_at.toISOString()).toBe('2026-10-26T12:00:00.000Z');
    expect(no?.marketing_consent).toBe(false);
    expect(no?.marketing_consented_at).toBeNull();
  });

  it('writes a reservation.created event to the outbox in the same transaction', async () => {
    const response = await book(app, LAGOS, bookingBody(standard, { checkIn: '2026-12-20', checkOut: '2026-12-21' }));
    const { code } = response.json().reservation;
    const events = await db.pool.query<{ event_type: string; aggregate_version: number; published_at: Date | null; payload: any }>(
      `SELECT o.event_type, o.aggregate_version, o.published_at, o.payload
       FROM outbox_events o JOIN reservations r ON r.id = o.aggregate_id WHERE r.code = $1`,
      [code],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({ event_type: 'reservation.created', aggregate_version: 1, published_at: null });
    expect(events.rows[0]?.payload).toMatchObject({
      code,
      status: 'CONFIRMED',
      version: 1,
      guest: { email: 'ayse@example.com' },
      consents: { marketing: false },
    });
  });

  describe('rejects with the right status', () => {
    it('409 SOLD_OUT, and a failed attempt leaves no trace (no partial nights, no reservation, no key)', async () => {
      await setBooked(db.pool, LAGOS, 'standard', '2026-12-02', 20); // the middle night is full
      const key = newKey();
      const response = await book(app, LAGOS, bookingBody(standard, { checkIn: '2026-12-01', checkOut: '2026-12-04' }), { key });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: { code: 'SOLD_OUT' } });
      const nights = await bookedByNight(db.pool, LAGOS, 'standard', '2026-12-01', '2026-12-04');
      expect(nights.map((n) => n.booked)).toEqual([0, 20, 0]); // nights 1 and 3 were rolled back
      expect(await count(db.pool, 'idempotency_keys', 'key = $1', [key])).toBe(0);
    });

    it('422 KVKK_CONSENT_REQUIRED when the notice is not acknowledged', async () => {
      const response = await book(app, LAGOS, bookingBody(standard, { consents: { kvkk: false, marketing: true } }));
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('KVKK_CONSENT_REQUIRED');
    });

    it.each([
      ['CHECK_IN_IN_PAST', { checkIn: '2026-10-25', checkOut: '2026-10-27' }],
      ['INVALID_DATE_RANGE', { checkIn: '2026-11-10', checkOut: '2026-11-10' }],
      ['STAY_TOO_LONG', { checkIn: '2026-11-01', checkOut: '2026-12-15' }],
      ['CAPACITY_EXCEEDED', { adults: 3 }],
      ['INVALID_GUEST_COUNT', { adults: 0 }],
      ['INVALID_EMAIL', { guest: { firstName: 'A', lastName: 'B', email: 'nope', phone: '0532 123 45 67' } }],
      ['INVALID_PHONE', { guest: { firstName: 'A', lastName: 'B', email: 'a@b.co', phone: '123' } }],
    ])('422 %s', async (code: string, override: Record<string, unknown>) => {
      const response = await book(app, LAGOS, bookingBody(standard, override));
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe(code);
    });

    it("404 ROOM_TYPE_NOT_FOUND for another hotel's room type (tenant isolation)", async () => {
      const response = await book(app, LAGOS, bookingBody(caveRoom));
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('ROOM_TYPE_NOT_FOUND');
    });

    it('400 for malformed requests: bad JSON, unknown field, wrong types, bad id', async () => {
      const raw = await app.inject({
        method: 'POST',
        url: `/v1/public/${LAGOS}/reservations`,
        headers: { 'content-type': 'application/json', 'idempotency-key': newKey() },
        payload: '{not json',
      });
      expect(raw.statusCode).toBe(400);

      for (const body of [
        { ...bookingBody(standard), adluts: 2 },
        bookingBody(standard, { adults: '2' }),
        bookingBody('not-a-uuid'),
        bookingBody(standard, { checkIn: '2026-02-30' }),
        bookingBody(standard, { consents: undefined }),
      ]) {
        const response = await book(app, LAGOS, body);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('INVALID_REQUEST');
      }
    });

    it('404 for an unknown hotel key', async () => {
      const response = await book(app, 'pk_does_not_exist', bookingBody(standard));
      expect(response.statusCode).toBe(404);
    });
  });
});

describe('Idempotency-Key (M7)', () => {
  it('is required, and must look like a key', async () => {
    const missing = await book(app, LAGOS, bookingBody(standard), { key: null });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('INVALID_REQUEST');

    const tooShort = await book(app, LAGOS, bookingBody(standard), { key: 'abc' });
    expect(tooShort.statusCode).toBe(400);
  });

  it('answers a retry with the SAME reservation instead of booking twice', async () => {
    const key = newKey();
    const body = bookingBody(standard, { checkIn: '2027-03-01', checkOut: '2027-03-03' });

    const first = await book(app, LAGOS, body, { key });
    const retry = await book(app, LAGOS, body, { key });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(await count(db.pool, 'reservations', `check_in = DATE '2027-03-01'`)).toBe(1);
    const nights = await bookedByNight(db.pool, LAGOS, 'standard', '2027-03-01', '2027-03-03');
    expect(nights.map((n) => n.booked)).toEqual([1, 1]);
  });

  it('treats an equivalent request (different formatting) as the same request', async () => {
    const key = newKey();
    const first = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-03-05', checkOut: '2027-03-06' }), { key });
    const retry = await book(
      app,
      LAGOS,
      bookingBody(standard, {
        checkIn: '2027-03-05',
        checkOut: '2027-03-06',
        guest: { firstName: ' Ayşe ', lastName: 'Yılmaz', email: 'AYSE@example.com', phone: '+90 532 123 45 67' },
      }),
      { key },
    );
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json()).toEqual(first.json());
  });

  it('collapses 10 simultaneous retries with one key into ONE reservation', async () => {
    const key = newKey();
    const body = bookingBody(standard, { checkIn: '2027-03-10', checkOut: '2027-03-12' });

    const responses = await Promise.all(Array.from({ length: 10 }, () => book(app, LAGOS, body, { key })));

    expect(responses.map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    expect(new Set(responses.map((r) => r.json().reservation.code)).size).toBe(1);
    expect(responses.filter((r) => r.headers['idempotent-replayed'] === 'true')).toHaveLength(9);
    expect(await count(db.pool, 'reservations', `check_in = DATE '2027-03-10'`)).toBe(1);
    const nights = await bookedByNight(db.pool, LAGOS, 'standard', '2027-03-10', '2027-03-12');
    expect(nights.map((n) => n.booked)).toEqual([1, 1]);
  });

  it('refuses the same key with a different request (422) and does not book', async () => {
    const key = newKey();
    await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-03-15', checkOut: '2027-03-16' }), { key });
    const other = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-03-15', checkOut: '2027-03-17' }), { key });

    expect(other.statusCode).toBe(422);
    expect(other.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await count(db.pool, 'reservations', `check_in = DATE '2027-03-15'`)).toBe(1);
  });

  it('scopes keys per hotel: another hotel using the same key gets its own reservation', async () => {
    const key = newKey();
    const lagos = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-03-20', checkOut: '2027-03-21' }), { key });
    const peri = await book(app, PERI, bookingBody(caveRoom, { checkIn: '2027-03-20', checkOut: '2027-03-21' }), { key });

    expect(lagos.statusCode).toBe(201);
    expect(peri.statusCode).toBe(201);
    expect(peri.headers['idempotent-replayed']).toBeUndefined();
    expect(peri.json().reservation.roomType.code).toBe('cave-room');
  });

  it('lets a client retry after a SOLD_OUT with the same key once a room frees up', async () => {
    const key = newKey();
    const dates = { checkIn: '2027-04-01', checkOut: '2027-04-02' };
    await setBooked(db.pool, PERI, 'terrace-suite', '2027-04-01', 2);
    const terrace = await roomTypeId(db.pool, PERI, 'terrace-suite');

    const soldOut = await book(app, PERI, bookingBody(terrace, { ...dates, adults: 2 }), { key });
    expect(soldOut.statusCode).toBe(409);

    await setBooked(db.pool, PERI, 'terrace-suite', '2027-04-01', 1);
    const retry = await book(app, PERI, bookingBody(terrace, { ...dates, adults: 2 }), { key });
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('POST /v1/public/:hotelKey/reservations/:code/cancel (M8, S1)', () => {
  async function createOne(checkIn: string, checkOut: string): Promise<string> {
    const response = await book(app, LAGOS, bookingBody(standard, { checkIn, checkOut }));
    expect(response.statusCode).toBe(201);
    return response.json().reservation.code as string;
  }

  it('cancels, gives every night back, bumps the version and records a reservation.cancelled event', async () => {
    const code = await createOne('2027-05-01', '2027-05-04');
    expect((await bookedByNight(db.pool, LAGOS, 'standard', '2027-05-01', '2027-05-04')).map((n) => n.booked)).toEqual([1, 1, 1]);

    const response = await cancel(app, LAGOS, code, 'ayse@example.com');

    expect(response.statusCode).toBe(200);
    expect(response.json().reservation).toMatchObject({ code, status: 'CANCELLED' });
    expect(response.json().reservation.cancelledAt).toBe('2026-10-26T12:00:00.000Z');
    expect((await bookedByNight(db.pool, LAGOS, 'standard', '2027-05-01', '2027-05-04')).map((n) => n.booked)).toEqual([0, 0, 0]);

    const events = await db.pool.query<{ event_type: string; aggregate_version: number; payload: any }>(
      `SELECT o.event_type, o.aggregate_version, o.payload
       FROM outbox_events o JOIN reservations r ON r.id = o.aggregate_id
       WHERE r.code = $1 ORDER BY o.seq`,
      [code],
    );
    expect(events.rows.map((e) => `${e.event_type}@${e.aggregate_version}`)).toEqual([
      'reservation.created@1',
      'reservation.cancelled@2',
    ]);
    expect(events.rows[1]?.payload).toMatchObject({ status: 'CANCELLED', version: 2 });
  });

  it('makes the rooms bookable again', async () => {
    await setBooked(db.pool, LAGOS, 'standard', '2027-05-10', 19);
    const code = await createOne('2027-05-10', '2027-05-11'); // takes the last one
    const soldOut = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-05-10', checkOut: '2027-05-11' }));
    expect(soldOut.statusCode).toBe(409);

    await cancel(app, LAGOS, code, 'ayse@example.com');

    const again = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-05-10', checkOut: '2027-05-11' }));
    expect(again.statusCode).toBe(201);
  });

  it('answers 409 INVALID_STATE_TRANSITION when cancelling twice, and releases only once', async () => {
    const code = await createOne('2027-05-20', '2027-05-22');
    await cancel(app, LAGOS, code, 'ayse@example.com');
    const second = await cancel(app, LAGOS, code, 'ayse@example.com');

    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'CANCELLED', to: 'CANCELLED' } });
    expect((await bookedByNight(db.pool, LAGOS, 'standard', '2027-05-20', '2027-05-22')).map((n) => n.booked)).toEqual([0, 0]);
  });

  it('accepts the code and email in any letter case', async () => {
    const code = await createOne('2027-05-25', '2027-05-26');
    const response = await cancel(app, LAGOS, code.toLowerCase(), ' AYSE@Example.com ');
    expect(response.statusCode).toBe(200);
  });

  it('answers the same 404 for a wrong email, an unknown code and a malformed code', async () => {
    const code = await createOne('2027-06-01', '2027-06-02');
    const bodies = await Promise.all([
      cancel(app, LAGOS, code, 'someone.else@example.com'),
      cancel(app, LAGOS, 'RT-ZZZZZZZZ', 'ayse@example.com'),
      cancel(app, LAGOS, 'whatever', 'ayse@example.com'),
    ]);
    for (const response of bodies) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('RESERVATION_NOT_FOUND');
    }
    expect((await bookedByNight(db.pool, LAGOS, 'standard', '2027-06-01', '2027-06-02'))[0]?.booked).toBe(1);
  });

  it("cannot cancel another hotel's reservation, even with the right code and email (tenant isolation)", async () => {
    const code = await createOne('2027-06-10', '2027-06-11');
    const response = await cancel(app, PERI, code, 'ayse@example.com');
    expect(response.statusCode).toBe(404);
    expect((await db.pool.query(`SELECT status FROM reservations WHERE code = $1`, [code])).rows[0]).toEqual({ status: 'CONFIRMED' });
  });

  it('400 for a missing or unknown body field', async () => {
    const response = await app.inject({ method: 'POST', url: `/v1/public/${LAGOS}/reservations/RT-ABCDEFGH/cancel`, payload: { mail: 'x' } });
    expect(response.statusCode).toBe(400);
  });
});

describe('CORS on the reservation endpoints', () => {
  it('answers the browser preflight for POST with the Idempotency-Key header allowed', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: `/v1/public/${LAGOS}/reservations`,
      headers: {
        origin: LAGOS_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,idempotency-key',
      },
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(LAGOS_ORIGIN);
    expect(response.headers['access-control-allow-headers']).toContain('Idempotency-Key');
  });

  it('refuses to book from another hotel\'s website, and lets the widget read the replay header', async () => {
    const blocked = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-07-01', checkOut: '2027-07-02' }), { origin: PERI_ORIGIN });
    expect(blocked.statusCode).toBe(403);
    expect(await count(db.pool, 'reservations', `check_in = DATE '2027-07-01'`)).toBe(0);

    const allowed = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-07-01', checkOut: '2027-07-02' }), { origin: LAGOS_ORIGIN });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.headers['access-control-expose-headers']).toBe('Idempotent-Replayed');
  });
});

describe('database guarantees behind the reservation tables', () => {
  it('keeps the unique (hotel, code) rule and the composite room-type foreign key', async () => {
    const created = await book(app, LAGOS, bookingBody(standard, { checkIn: '2027-08-01', checkOut: '2027-08-02' }));
    const code = created.json().reservation.code as string;
    const duplicate = db.pool.query(
      `INSERT INTO reservations (hotel_id, room_type_id, code, status, check_in, check_out, adults, children,
         total_price_minor, currency, guest_first_name, guest_last_name, guest_email, guest_phone,
         kvkk_accepted_at, marketing_consent)
       SELECT hotel_id, room_type_id, code, status, check_in, check_out, adults, children, total_price_minor,
         currency, guest_first_name, guest_last_name, guest_email, guest_phone, kvkk_accepted_at, marketing_consent
       FROM reservations WHERE code = $1`,
      [code],
    );
    await expect(duplicate).rejects.toMatchObject({ code: '23505' });
  });
});
