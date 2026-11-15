import type { Clock } from '../../../shared/clock.js';
import type { Hotel, HotelId } from '../../tenancy/domain/hotel.js';
import type { StaySearchInput } from '../domain/stay-search.js';
import type { AvailabilityResult, SearchAvailability } from './search-availability.js';

export type CacheOutcome = 'hit' | 'miss' | 'off';

export interface CacheOptions {
  /** How long an answer may be reused. 0 (or less) turns the cache off: every call goes through. */
  ttlMs: number;
  /** Upper bound on stored answers; the oldest is dropped first. */
  maxEntries?: number;
}

interface Entry {
  readonly result: AvailabilityResult;
  readonly expiresAt: number;
  readonly hotelId: HotelId;
}

/**
 * S6 - short-lived server-side cache of availability answers (ADR-0009).
 *
 * Availability is read far more often than it changes (every visitor browsing, one in many
 * booking), and each answer costs two queries. The cache never decides anything: the booking
 * itself does not look at it, the conditional UPDATE stays the only authority (ADR-0002), so a
 * stale answer can at worst show a room that turns out to be sold (-> a clean 409 SOLD_OUT).
 * Staleness is bounded three ways:
 *   - TTL: an answer is reused for `ttlMs` at most;
 *   - invalidation: every booking, cancellation and SOLD_OUT drops all answers of that hotel
 *     (read-your-writes on this instance);
 *   - generation check: an answer computed while a booking committed is NOT stored.
 * Concurrent identical misses share one computation (single flight), so a burst of visitors
 * asking the same question costs one query, not hundreds.
 */
export class CachedAvailability {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<AvailabilityResult>>();
  private readonly generations = new Map<HotelId, number>();
  private readonly maxEntries: number;
  readonly stats = { hits: 0, misses: 0, invalidations: 0 };

  constructor(
    private readonly search: Pick<SearchAvailability, 'execute'>,
    private readonly clock: Clock,
    private readonly options: CacheOptions,
  ) {
    this.maxEntries = options.maxEntries ?? 1000;
  }

  async execute(hotel: Hotel, input: StaySearchInput): Promise<{ result: AvailabilityResult; cache: CacheOutcome }> {
    if (this.options.ttlMs <= 0) return { result: await this.search.execute(hotel, input), cache: 'off' };

    const key = `${hotel.id}|${input.checkIn}|${input.checkOut}|${input.adults}|${input.children}`;
    const now = this.clock.now().getTime();
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      if (cached.expiresAt > now) {
        this.stats.hits++;
        return { result: cached.result, cache: 'hit' };
      }
      this.entries.delete(key);
    }

    this.stats.misses++;
    let pending = this.inFlight.get(key);
    if (pending === undefined) {
      const generation = this.generations.get(hotel.id) ?? 0;
      pending = this.search
        .execute(hotel, input) // a failure (validation, database) is never cached
        .then((result) => {
          if ((this.generations.get(hotel.id) ?? 0) === generation) this.store(key, hotel.id, result, now);
          return result;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return { result: await pending, cache: 'miss' };
  }

  /** Call after anything that changes a hotel's stock (booking, cancellation, or a SOLD_OUT that proves staleness). */
  invalidateHotel(hotelId: HotelId): void {
    this.generations.set(hotelId, (this.generations.get(hotelId) ?? 0) + 1);
    for (const [key, entry] of this.entries) if (entry.hotelId === hotelId) this.entries.delete(key);
    this.stats.invalidations++;
  }

  private store(key: string, hotelId: HotelId, result: AvailabilityResult, now: number): void {
    this.entries.set(key, { result, hotelId, expiresAt: now + this.options.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }
}
