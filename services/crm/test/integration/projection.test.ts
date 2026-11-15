import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectReservationEvent } from '../../src/modules/guests/application/project-reservation-event.js';
import { PgProjectionStore } from '../../src/modules/guests/infra/pg-projection-store.js';
import { PoisonMessageError } from '../../src/shared/errors.js';
import { LAGOS, PERI, reservationEvent } from '../support/events.js';
import { createTestDatabase, type TestDatabase } from '../support/test-database.js';

let db: TestDatabase;
let projector: ProjectReservationEvent;

beforeAll(async () => {
  db = await createTestDatabase({ poolSize: 20 });
  projector = new ProjectReservationEvent(new PgProjectionStore(db.pool));
});

afterAll(async () => {
  await db?.drop();
});

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => (await db.pool.query(sql, params)).rows[0] as T;
const guestByEmail = (email: string) =>
  one<{ id: string; first_name: string; last_name: string; phone: string; marketing_consent: boolean }>(
    'SELECT * FROM guests WHERE email = $1',
    [email],
  );

describe('ProjectReservationEvent (M10, M11)', () => {
  it('creates the hotel, the guest and the reservation from a created event', async () => {
    const event = reservationEvent({ email: 'first@example.com', code: 'RT-FIRST001', marketing: true });
    expect(await projector.handle(event)).toBe('applied');

    expect(await one('SELECT name, public_key FROM hotels WHERE id = $1', [LAGOS.id])).toEqual({ name: LAGOS.name, public_key: LAGOS.key });
    const guest = await guestByEmail('first@example.com');
    expect(guest).toMatchObject({ first_name: 'Ayşe', last_name: 'Yılmaz', phone: '+905321234567', marketing_consent: true });
    expect(await one('SELECT status, version, nights, room_type_code FROM guest_reservations WHERE code = $1', ['RT-FIRST001'])).toEqual({
      status: 'CONFIRMED', version: 1, nights: 3, room_type_code: 'standard',
    });
  });

  it('is idempotent: delivering the same event again changes nothing', async () => {
    const event = reservationEvent({ email: 'dup@example.com', code: 'RT-DUP00001' });
    expect(await projector.handle(event)).toBe('applied');
    expect(await projector.handle(event)).toBe('duplicate');
    expect(await projector.handle(event)).toBe('duplicate');
    expect((await one<{ n: number }>("SELECT count(*)::int AS n FROM guest_reservations WHERE code = 'RT-DUP00001'")).n).toBe(1);
  });

  it('applies exactly once when the same event is delivered 8 times concurrently', async () => {
    const event = reservationEvent({ email: 'race@example.com', code: 'RT-RACE0001' });
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => projector.handle(event)));
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(7);
  });

  it('matches the same person across bookings by email, ignoring case and spaces', async () => {
    await projector.handle(reservationEvent({ email: 'same@example.com', code: 'RT-SAME0001' }));
    await projector.handle(reservationEvent({ email: '  SAME@Example.com ', code: 'RT-SAME0002', checkIn: '2027-01-10', checkOut: '2027-01-12' }));
    const guests = await db.pool.query("SELECT id FROM guests WHERE email = 'same@example.com'");
    expect(guests.rowCount).toBe(1);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM guest_reservations WHERE guest_id = $1', [guests.rows[0].id])).n).toBe(2);
  });

  it('creates ONE guest when different new reservations of the same person arrive at the same moment', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => projector.handle(reservationEvent({ email: 'burst@example.com', code: `RT-BURST00${i}` }))),
    );
    expect((await db.pool.query("SELECT 1 FROM guests WHERE email = 'burst@example.com'")).rowCount).toBe(1);
    expect((await db.pool.query("SELECT 1 FROM guest_reservations WHERE code LIKE 'RT-BURST%'")).rowCount).toBe(6);
  });

  it('keeps two guests of one hotel with different emails apart, even with the same phone', async () => {
    await projector.handle(reservationEvent({ email: 'mother@example.com', firstName: 'Anne', phone: '+905551112233', code: 'RT-FAM00001' }));
    await projector.handle(reservationEvent({ email: 'daughter@example.com', firstName: 'Kız', phone: '+905551112233', code: 'RT-FAM00002' }));
    expect((await db.pool.query("SELECT 1 FROM guests WHERE phone = '+905551112233'")).rowCount).toBe(2);
  });

  it('does not merge people across hotels: the same email is a separate guest at each hotel', async () => {
    await projector.handle(reservationEvent({ email: 'both@example.com', code: 'RT-BOTH0001', hotel: LAGOS }));
    await projector.handle(reservationEvent({ email: 'both@example.com', code: 'RT-BOTH0002', hotel: PERI }));
    expect((await db.pool.query("SELECT 1 FROM guests WHERE email = 'both@example.com'")).rowCount).toBe(2);
  });

  describe('events that arrive late or out of order', () => {
    it('applies the cancellation and ignores the stale created event that follows it', async () => {
      const reservationId = randomUUID();
      const base = { reservationId, email: 'late@example.com', code: 'RT-LATE0001' };
      expect(await projector.handle(reservationEvent({ ...base, type: 'reservation.cancelled' }))).toBe('applied');
      expect(await projector.handle(reservationEvent({ ...base, type: 'reservation.created' }))).toBe('stale');
      expect(await one('SELECT status, version FROM guest_reservations WHERE code = $1', ['RT-LATE0001'])).toEqual({ status: 'CANCELLED', version: 2 });
    });

    it('moves a reservation forward on cancellation in the normal order', async () => {
      const base = { reservationId: randomUUID(), email: 'normal@example.com', code: 'RT-NORM0001' };
      await projector.handle(reservationEvent(base));
      await projector.handle(reservationEvent({ ...base, type: 'reservation.cancelled' }));
      expect((await one<{ status: string; cancelled_at: Date }>('SELECT status, cancelled_at FROM guest_reservations WHERE code = $1', ['RT-NORM0001'])).status).toBe('CANCELLED');
    });

    it('lets the newest booking own contact details and marketing consent, whatever the arrival order', async () => {
      await projector.handle(reservationEvent({ email: 'moved@example.com', code: 'RT-MOVE0002', createdAt: '2026-09-01T10:00:00.000Z', phone: '+905000000002', firstName: 'Yeni', marketing: false }));
      // an OLDER booking's event arrives afterwards: it must not overwrite the newer details
      await projector.handle(reservationEvent({ email: 'moved@example.com', code: 'RT-MOVE0001', createdAt: '2026-03-01T10:00:00.000Z', phone: '+905000000001', firstName: 'Eski', marketing: true }));
      expect(await guestByEmail('moved@example.com')).toMatchObject({ first_name: 'Yeni', phone: '+905000000002', marketing_consent: false });
    });

    it("an old booking's cancellation does not undo a later marketing opt-out", async () => {
      const old = { reservationId: randomUUID(), email: 'optout@example.com', code: 'RT-OPT00001', createdAt: '2026-03-01T10:00:00.000Z', marketing: true };
      await projector.handle(reservationEvent(old));
      await projector.handle(reservationEvent({ email: 'optout@example.com', code: 'RT-OPT00002', createdAt: '2026-09-01T10:00:00.000Z', marketing: false }));
      await projector.handle(reservationEvent({ ...old, type: 'reservation.cancelled' }));
      expect((await guestByEmail('optout@example.com')).marketing_consent).toBe(false);
    });
  });

  it('ignores event types it does not know and rejects contract violations as poison', async () => {
    expect(await projector.handle({ ...reservationEvent(), type: 'reservation.checked-in' })).toBe('ignored');
    await expect(projector.handle({ nonsense: true })).rejects.toBeInstanceOf(PoisonMessageError);
  });

  it('writes nothing when a step fails mid-way (all or nothing, so a redelivery can retry)', async () => {
    const event = reservationEvent({ email: 'rollback@example.com', code: 'RT-ROLL0001' }) as { eventId: string };
    // make the reservation insert fail: the code is already taken by another reservation
    await projector.handle(reservationEvent({ email: 'rollback-owner@example.com', code: 'RT-ROLL0001' }));
    await expect(projector.handle(event)).rejects.toMatchObject({ code: '23505' });
    expect((await db.pool.query('SELECT 1 FROM processed_events WHERE event_id = $1', [event.eventId])).rowCount).toBe(0);
    expect((await db.pool.query("SELECT 1 FROM guests WHERE email = 'rollback@example.com'")).rowCount).toBe(0);
  });
});
