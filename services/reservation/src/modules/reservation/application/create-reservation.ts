import { createHash } from 'node:crypto';
import type { Clock } from '../../../shared/clock.js';
import { DomainError } from '../../../shared/errors.js';
import { todayInZone } from '../../../shared/local-date.js';
import type { InventoryReader } from '../../inventory/application/ports.js';
import { stayTotalPriceMinor } from '../../inventory/domain/availability.js';
import { createStaySearch, type StaySearchInput } from '../../inventory/domain/stay-search.js';
import type { Hotel, HotelId } from '../../tenancy/domain/hotel.js';
import { generateReservationCode } from '../domain/code.js';
import { recordConsents, type ConsentInput } from '../domain/consent.js';
import { reservationCreated } from '../domain/events.js';
import { createGuest, type GuestInput } from '../domain/guest.js';
import type { Reservation } from '../domain/reservation.js';
import type { UnitOfWork } from './ports.js';
import { toReservationView, type ReservationView } from './reservation-view.js';

export interface CreateReservationInput extends StaySearchInput {
  roomTypeId: string;
  guest: GuestInput;
  consents: ConsentInput;
}

export interface CreateReservationResult {
  /** HTTP status of the answer. Part of the use case result because the stored answer is replayed verbatim. */
  status: number;
  body: { reservation: ReservationView };
  /** True when this is the stored answer to an earlier request with the same Idempotency-Key. */
  replayed: boolean;
}

const MAX_CODE_ATTEMPTS = 5;

type RandomBytes = (size: number) => Uint8Array;

/**
 * M6 + M7: create a reservation without ever overbooking, and safely under client retries.
 *
 * Everything that changes state happens in ONE transaction:
 *   1. claim the Idempotency-Key (a retry of a finished request gets the stored answer back);
 *   2. take one room on every night with a conditional UPDATE (ADR-0002); if any night has no
 *      free room the whole transaction rolls back and nothing is left behind, not even the key;
 *   3. insert the reservation;
 *   4. write the `reservation.created` event to the outbox (ADR-0001);
 *   5. store the response under the key.
 * Either all five are visible to other transactions, or none is.
 */
export class CreateReservation {
  constructor(
    private readonly catalog: Pick<InventoryReader, 'findRoomType'>,
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly randomBytes: RandomBytes,
    /** Called when a hotel's stock changed or was found to differ from what readers may have cached. */
    private readonly inventoryChanged: (hotelId: HotelId) => void = () => undefined,
  ) {}

  async execute(hotel: Hotel, idempotencyKey: string, input: CreateReservationInput): Promise<CreateReservationResult> {
    let result: CreateReservationResult;
    try {
      result = await this.book(hotel, idempotencyKey, input);
    } catch (error) {
      // SOLD_OUT proves that whoever showed this room as free (a cache) was out of date.
      if (error instanceof DomainError && error.code === 'SOLD_OUT') this.inventoryChanged(hotel.id);
      throw error;
    }
    if (!result.replayed) this.inventoryChanged(hotel.id); // committed: the stock changed
    return result;
  }

  private async book(hotel: Hotel, idempotencyKey: string, input: CreateReservationInput): Promise<CreateReservationResult> {
    const now = this.clock.now();

    // 1. Validate everything that does not need the database's help.
    const today = todayInZone(now, hotel.timezone);
    const stay = createStaySearch(input, today);
    const guest = createGuest(input.guest);
    const consents = recordConsents(input.consents, now);

    const roomType = await this.catalog.findRoomType(hotel.id, input.roomTypeId);
    if (roomType === null) {
      throw new DomainError('ROOM_TYPE_NOT_FOUND', 'This hotel has no such room type.', 'not_found');
    }
    if (roomType.maxGuests < stay.guests) {
      throw new DomainError('CAPACITY_EXCEEDED', 'This room type cannot host that many guests.', 'rule_violation', {
        guests: stay.guests,
        maxGuests: roomType.maxGuests,
      });
    }
    const totalPriceMinor = stayTotalPriceMinor(roomType, stay);

    // Hash of the *normalized* request: "ALI@x.com " and "ali@x.com" are the same request.
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          roomTypeId: roomType.id,
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          adults: stay.adults,
          children: stay.children,
          guest,
          marketing: consents.marketingConsentedAt !== null,
        }),
      )
      .digest('hex');

    // 2. The transaction.
    return this.unitOfWork.run(async (tx): Promise<CreateReservationResult> => {
      const claim = await tx.idempotency.claim(hotel.id, idempotencyKey, requestHash);
      if (claim.kind === 'replay') {
        return {
          status: claim.response.status,
          body: claim.response.body as CreateReservationResult['body'],
          replayed: true,
        };
      }
      if (claim.kind === 'conflict') {
        throw new DomainError(
          'IDEMPOTENCY_KEY_REUSED',
          'This Idempotency-Key was already used for a different request.',
          'rule_violation',
        );
      }

      const taken = await tx.stock.takeNights(hotel.id, roomType.id, stay.checkIn, stay.checkOut);
      if (taken !== stay.nights) {
        // Throwing rolls back the nights that were taken, so a partial stay is never sold.
        throw new DomainError('SOLD_OUT', 'The room type is no longer available for these dates.', 'conflict', {
          roomTypeId: roomType.id,
        });
      }

      let reservation: Reservation | null = null;
      for (let attempt = 0; reservation === null && attempt < MAX_CODE_ATTEMPTS; attempt++) {
        reservation = await tx.reservations.insert({
          hotelId: hotel.id,
          roomTypeId: roomType.id,
          code: generateReservationCode(this.randomBytes),
          status: 'CONFIRMED',
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          adults: stay.adults,
          children: stay.children,
          totalPriceMinor,
          currency: hotel.currency,
          guest,
          kvkkAcceptedAt: consents.kvkkAcceptedAt,
          marketingConsentedAt: consents.marketingConsentedAt,
          createdAt: now,
        });
      }
      if (reservation === null) {
        throw new Error('Could not allocate a unique reservation code'); // 2^40 space: a bug, not bad luck
      }

      await tx.outbox.append(reservation, reservationCreated(reservation, hotel, roomType));

      const response = { status: 201, body: { reservation: toReservationView(reservation, roomType) } };
      await tx.idempotency.complete(hotel.id, idempotencyKey, response);
      return { ...response, replayed: false };
    });
  }
}
