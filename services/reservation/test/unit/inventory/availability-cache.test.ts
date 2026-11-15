import { describe, expect, it } from 'vitest';
import { CachedAvailability } from '../../../src/modules/inventory/application/availability-cache.js';
import type { AvailabilityResult } from '../../../src/modules/inventory/application/search-availability.js';
import { DomainError } from '../../../src/shared/errors.js';
import { localDate } from '../../../src/shared/local-date.js';
import { hotelFixture } from '../../support/fixtures.js';

const lagos = hotelFixture({ id: 'hotel-lagos' });
const peri = hotelFixture({ id: 'hotel-peri' });
const input = { checkIn: localDate('2026-11-01'), checkOut: localDate('2026-11-04'), adults: 2, children: 0 };

class Harness {
  now = 1_000_000;
  calls = 0;
  gate: Promise<void> | undefined;
  failNext: Error | undefined;
  readonly clock = { now: () => new Date(this.now) };
  readonly search = {
    execute: async (hotel: { id: string }): Promise<AvailabilityResult> => {
      this.calls++;
      const call = this.calls;
      if (this.gate) await this.gate;
      if (this.failNext) {
        const error = this.failNext;
        this.failNext = undefined;
        throw error;
      }
      return { call, hotel: hotel.id } as unknown as AvailabilityResult;
    },
  };
  cache(ttlMs = 10_000, maxEntries?: number) {
    return new CachedAvailability(this.search, this.clock, { ttlMs, ...(maxEntries ? { maxEntries } : {}) });
  }
}

describe('CachedAvailability (S6)', () => {
  it('answers a repeat question from memory within the TTL, and recomputes after it', async () => {
    const h = new Harness();
    const cache = h.cache(10_000);
    expect((await cache.execute(lagos, input)).cache).toBe('miss');
    expect((await cache.execute(lagos, input)).cache).toBe('hit');
    h.now += 9_999;
    expect((await cache.execute(lagos, input)).cache).toBe('hit');
    h.now += 2;
    expect((await cache.execute(lagos, input)).cache).toBe('miss');
    expect(h.calls).toBe(2);
    expect(cache.stats).toMatchObject({ hits: 2, misses: 2 });
  });

  it('keys by hotel and by every search parameter', async () => {
    const h = new Harness();
    const cache = h.cache();
    await cache.execute(lagos, input);
    await cache.execute(peri, input);
    await cache.execute(lagos, { ...input, adults: 1 });
    await cache.execute(lagos, { ...input, children: 1 });
    await cache.execute(lagos, { ...input, checkOut: localDate('2026-11-05') });
    expect(h.calls).toBe(5);
  });

  it('is off when the TTL is 0: every call goes through', async () => {
    const h = new Harness();
    const cache = h.cache(0);
    expect((await cache.execute(lagos, input)).cache).toBe('off');
    expect((await cache.execute(lagos, input)).cache).toBe('off');
    expect(h.calls).toBe(2);
  });

  it("invalidating one hotel drops only that hotel's answers", async () => {
    const h = new Harness();
    const cache = h.cache();
    await cache.execute(lagos, input);
    await cache.execute(peri, input);
    cache.invalidateHotel('hotel-lagos');
    expect((await cache.execute(lagos, input)).cache).toBe('miss');
    expect((await cache.execute(peri, input)).cache).toBe('hit');
  });

  it('shares ONE computation between simultaneous identical misses (single flight)', async () => {
    const h = new Harness();
    let release!: () => void;
    h.gate = new Promise<void>((resolve) => (release = resolve));
    const cache = h.cache();
    const answers = Promise.all(Array.from({ length: 25 }, () => cache.execute(lagos, input)));
    release();
    const results = await answers;
    expect(h.calls).toBe(1);
    expect(new Set(results.map((r) => r.result)).size).toBe(1);
  });

  it('does not store an answer that was computed while a booking changed the stock', async () => {
    const h = new Harness();
    let release!: () => void;
    h.gate = new Promise<void>((resolve) => (release = resolve));
    const cache = h.cache();

    const slow = cache.execute(lagos, input); // starts computing from the pre-booking state
    cache.invalidateHotel('hotel-lagos'); // a booking commits meanwhile
    release();
    await slow;

    h.gate = undefined;
    expect((await cache.execute(lagos, input)).cache).toBe('miss'); // the stale answer was not kept
    expect((await cache.execute(lagos, input)).cache).toBe('hit');
  });

  it('never caches a failure (validation error, database down)', async () => {
    const h = new Harness();
    const cache = h.cache();
    h.failNext = new DomainError('CHECK_IN_IN_PAST', 'x');
    await expect(cache.execute(lagos, input)).rejects.toMatchObject({ code: 'CHECK_IN_IN_PAST' });
    expect((await cache.execute(lagos, input)).cache).toBe('miss');
    expect(h.calls).toBe(2);
  });

  it('keeps memory bounded: the oldest answers are dropped first', async () => {
    const h = new Harness();
    const cache = h.cache(10_000, 2);
    for (const adults of [1, 2, 3]) await cache.execute(lagos, { ...input, adults });
    expect((await cache.execute(lagos, { ...input, adults: 3 })).cache).toBe('hit');
    expect((await cache.execute(lagos, { ...input, adults: 1 })).cache).toBe('miss'); // evicted
  });
});
