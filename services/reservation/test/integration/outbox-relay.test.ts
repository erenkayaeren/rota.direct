import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { OutboxRelay } from '../../src/modules/reservation/application/outbox-relay.js';
import type { EventEnvelope, EventPublisher } from '../../src/modules/reservation/application/ports.js';
import { PgOutboxRelayStore } from '../../src/modules/reservation/infra/pg-outbox-relay-store.js';
import { fixedClock } from '../support/fixtures.js';
import { book, bookingBody, cancel, count, LAGOS, roomTypeId } from '../support/reservation-helpers.js';
import { createTestDatabase, type TestDatabase } from '../support/test-database.js';

class RecordingPublisher implements EventPublisher {
  readonly sent: EventEnvelope[] = [];
  /** Fail the publish call with this ordinal (1-based), once. */
  failOn: number | undefined;
  private calls = 0;
  async publish(event: EventEnvelope): Promise<void> {
    this.calls++;
    if (this.calls === this.failOn) throw new Error('broker unavailable');
    this.sent.push(event);
  }
}

let db: TestDatabase;
let standard: string;

beforeAll(async () => {
  db = await createTestDatabase({ poolSize: 10 });
  const app = await buildApp({ pool: db.pool, clock: fixedClock() });
  await app.ready();
  standard = await roomTypeId(db.pool, LAGOS, 'standard');
  // three events: created A, created B, cancelled A
  const a = await book(app, LAGOS, bookingBody(standard, { checkIn: '2026-11-10', checkOut: '2026-11-11' }));
  await book(app, LAGOS, bookingBody(standard, { checkIn: '2026-11-12', checkOut: '2026-11-13' }));
  await cancel(app, LAGOS, a.json().reservation.code, 'ayse@example.com');
  await app.close();
});

afterAll(async () => {
  await db?.drop();
});

const unpublished = (): Promise<number> => count(db.pool, 'outbox_events', 'published_at IS NULL');

describe('OutboxRelay (ADR-0006)', () => {
  it('stops at the first broker failure, keeps the rest pending, and resumes in order', async () => {
    const publisher = new RecordingPublisher();
    const relay = new OutboxRelay(new PgOutboxRelayStore(db.pool), publisher, 10);

    publisher.failOn = 2; // the second publish fails
    await expect(relay.runOnce()).rejects.toThrow('broker unavailable');
    expect(publisher.sent.map((e) => e.type)).toEqual(['reservation.created']);
    expect(await unpublished()).toBe(2); // the first is recorded, nothing is lost

    const result = await relay.runOnce();
    expect(result).toMatchObject({ ownedLock: true, published: 2 });
    expect(publisher.sent.map((e) => `${e.type}@${e.version}`)).toEqual([
      'reservation.created@1',
      'reservation.created@1',
      'reservation.cancelled@2',
    ]);
    expect(await unpublished()).toBe(0);
  });

  it('wraps the row in the public envelope, including the hotel and the full snapshot', async () => {
    const publisher = new RecordingPublisher();
    await db.pool.query('UPDATE outbox_events SET published_at = NULL');
    await new OutboxRelay(new PgOutboxRelayStore(db.pool), publisher, 10).runOnce();

    const [first] = publisher.sent;
    expect(first).toMatchObject({
      type: 'reservation.created',
      version: 1,
      data: { status: 'CONFIRMED', hotel: { key: LAGOS, name: 'Lagos Beach Hotel' }, roomType: { code: 'standard', name: { en: 'Standard' } }, guest: { email: 'ayse@example.com' } },
    });
    expect(first?.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first?.aggregateId).toBe(first?.data['reservationId']);
    expect(first?.hotelId).toBe((first?.data['hotel'] as { id: string }).id);
  });

  it('lets only one relay run at a time (the loser does nothing)', async () => {
    await db.pool.query('UPDATE outbox_events SET published_at = NULL');
    const slow: EventPublisher = {
      publish: () => new Promise((resolve) => setTimeout(resolve, 150)),
    };
    const fast = new RecordingPublisher();
    const store = new PgOutboxRelayStore(db.pool);

    const [first, second] = await Promise.all([
      new OutboxRelay(store, slow, 10).runOnce(),
      new Promise<void>((resolve) => setTimeout(resolve, 30)).then(() => new OutboxRelay(store, fast, 10).runOnce()),
    ]);

    expect(first).toMatchObject({ ownedLock: true, published: 3 });
    expect(second).toMatchObject({ ownedLock: false, published: 0 });
    expect(fast.sent).toHaveLength(0);
  });

  it('reports a full batch so the caller polls again immediately', async () => {
    await db.pool.query('UPDATE outbox_events SET published_at = NULL');
    const result = await new OutboxRelay(new PgOutboxRelayStore(db.pool), new RecordingPublisher(), 2).runOnce();
    expect(result).toMatchObject({ published: 2, batchWasFull: true });
  });
});
