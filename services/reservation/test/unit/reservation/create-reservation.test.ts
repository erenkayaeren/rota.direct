import { describe, expect, it } from 'vitest';
import type { InventoryStock } from '../../../src/modules/inventory/application/ports.js';
import type { RoomType } from '../../../src/modules/inventory/domain/availability.js';
import { CreateReservation, type CreateReservationInput } from '../../../src/modules/reservation/application/create-reservation.js';
import type {
  IdempotencyClaim,
  ReservationTx,
  StoredResponse,
  UnitOfWork,
} from '../../../src/modules/reservation/application/ports.js';
import type { NewReservation, Reservation } from '../../../src/modules/reservation/domain/reservation.js';
import { diffDays, localDate } from '../../../src/shared/local-date.js';
import { expectDomainErrorAsync } from '../../support/domain-error.js';
import { fixedClock, hotelFixture } from '../../support/fixtures.js';

const standard: RoomType = { id: '11111111-1111-4111-8111-111111111111', code: 'standard', name: { tr: 'Standart', en: 'Standard' }, maxGuests: 2, nightlyPriceMinor: 320_000 };
const hotel = hotelFixture({ id: 'hotel-1' });

const input: CreateReservationInput = {
  roomTypeId: standard.id,
  checkIn: localDate('2026-11-01'),
  checkOut: localDate('2026-11-04'),
  adults: 2,
  children: 0,
  guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'Ayse@Example.com', phone: '0532 123 45 67' },
  consents: { kvkk: true, marketing: true },
};

/** Records what the use case asked of the transaction; no database involved. */
class Harness {
  /** Pretend only this many nights are free; undefined = every requested night is free. */
  nightsAvailable: number | undefined;
  claim: IdempotencyClaim = { kind: 'claimed' };
  readonly events: string[] = [];
  inserted: NewReservation[] = [];
  stored: StoredResponse | undefined;
  codeCollisions = 0;
  hash: string | undefined;

  readonly stock: InventoryStock = {
    takeNights: async (_hotel, _roomType, checkIn, checkOut) => {
      this.events.push('take');
      return this.nightsAvailable ?? diffDays(checkIn, checkOut);
    },
    releaseNights: async () => 0,
  };

  readonly tx: ReservationTx = {
    stock: this.stock,
    roomTypes: { findRoomType: async () => standard },
    idempotency: {
      claim: async (_hotel, _key, hash) => {
        this.hash = hash;
        this.events.push('claim');
        return this.claim;
      },
      complete: async (_hotel, _key, response) => {
        this.events.push('complete');
        this.stored = response;
      },
    },
    reservations: {
      insert: async (reservation) => {
        this.events.push('insert');
        this.inserted.push(reservation);
        if (this.codeCollisions > 0) {
          this.codeCollisions--;
          return null;
        }
        return { ...reservation, id: 'res-1', version: 1, cancelledAt: null } as Reservation;
      },
      findByCodeForUpdate: async () => null,
      markCancelled: async () => {
        throw new Error('not used');
      },
    },
    outbox: {
      append: async (_reservation, event) => {
        this.events.push(`outbox:${event.type}`);
      },
    },
  };

  readonly unitOfWork: UnitOfWork = { run: (work) => work(this.tx) };

  useCase(roomType: RoomType | null = standard): CreateReservation {
    let counter = 0;
    return new CreateReservation(
      { findRoomType: async () => roomType },
      this.unitOfWork,
      fixedClock(),
      () => new Uint8Array(8).fill(counter++),
    );
  }
}

describe('CreateReservation', () => {
  it('claims the key, takes the nights, inserts, writes the event, stores the response - in that order', async () => {
    const h = new Harness();
    const result = await h.useCase().execute(hotel, 'key-0123456789abcdef', input);

    expect(h.events).toEqual(['claim', 'take', 'insert', 'outbox:reservation.created', 'complete']);
    expect(result.status).toBe(201);
    expect(result.replayed).toBe(false);
    expect(result.body.reservation).toMatchObject({
      status: 'CONFIRMED',
      nights: 3,
      totalPriceMinor: 960_000,
      currency: 'TRY',
      marketingConsent: true,
      guest: { email: 'ayse@example.com', phone: '+905321234567' },
    });
    expect(h.stored?.body).toEqual(result.body);
  });

  it('answers SOLD_OUT (409) when any night has no free room, and writes nothing else', async () => {
    const h = new Harness();
    h.nightsAvailable = 2; // one of the three nights is full
    const error = await expectDomainErrorAsync(h.useCase().execute(hotel, 'key-0123456789abcdef', input), 'SOLD_OUT');
    expect(error.kind).toBe('conflict');
    expect(h.events).toEqual(['claim', 'take']);
  });

  it('replays the stored answer without touching inventory', async () => {
    const h = new Harness();
    const stored = { status: 201, body: { reservation: { code: 'RT-ABCDEFGH' } } };
    h.claim = { kind: 'replay', response: stored };
    const result = await h.useCase().execute(hotel, 'key-0123456789abcdef', input);
    expect(result).toEqual({ ...stored, replayed: true });
    expect(h.events).toEqual(['claim']);
  });

  it('rejects the same key with a different request', async () => {
    const h = new Harness();
    h.claim = { kind: 'conflict' };
    await expectDomainErrorAsync(h.useCase().execute(hotel, 'key-0123456789abcdef', input), 'IDEMPOTENCY_KEY_REUSED');
    expect(h.events).toEqual(['claim']);
  });

  it('hashes the normalized request: formatting differences do not change it, content differences do', async () => {
    const hashOf = async (override: Partial<CreateReservationInput>): Promise<string | undefined> => {
      const h = new Harness();
      await h.useCase().execute(hotel, 'key-0123456789abcdef', { ...input, ...override });
      return h.hash;
    };
    const base = await hashOf({});
    expect(await hashOf({ guest: { ...input.guest, email: ' AYSE@example.com', phone: '+90 532 123 45 67' } })).toBe(base);
    expect(await hashOf({ adults: 1 })).not.toBe(base);
    expect(await hashOf({ checkOut: localDate('2026-11-05') })).not.toBe(base);
  });

  it('draws another code when the first one is taken', async () => {
    const h = new Harness();
    h.codeCollisions = 2;
    await h.useCase().execute(hotel, 'key-0123456789abcdef', input);
    expect(h.inserted).toHaveLength(3);
    expect(new Set(h.inserted.map((r) => r.code)).size).toBe(3);
  });

  it('validates before opening a transaction', async () => {
    const h = new Harness();
    const run = (override: Partial<CreateReservationInput>, code: string) =>
      expectDomainErrorAsync(h.useCase().execute(hotel, 'key-0123456789abcdef', { ...input, ...override }), code);

    await run({ consents: { kvkk: false, marketing: false } }, 'KVKK_CONSENT_REQUIRED');
    await run({ checkIn: localDate('2026-10-25') }, 'CHECK_IN_IN_PAST');
    await run({ adults: 3 }, 'CAPACITY_EXCEEDED');
    await run({ guest: { ...input.guest, email: 'nope' } }, 'INVALID_EMAIL');
    expect(h.events).toEqual([]);
  });

  it('answers ROOM_TYPE_NOT_FOUND when the room type is not this hotel\'s', async () => {
    const h = new Harness();
    const error = await expectDomainErrorAsync(h.useCase(null).execute(hotel, 'key-0123456789abcdef', input), 'ROOM_TYPE_NOT_FOUND');
    expect(error.kind).toBe('not_found');
  });
});
