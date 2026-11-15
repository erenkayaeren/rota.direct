import { DomainError } from '../../../shared/errors.js';
import { eachNight, type LocalDate } from '../../../shared/local-date.js';
import type { StaySearch } from './stay-search.js';

export interface RoomType {
  readonly id: string;
  readonly code: string;
  readonly name: { readonly tr: string; readonly en: string };
  readonly maxGuests: number;
  /** Minor units (kurus) in the hotel's currency. */
  readonly nightlyPriceMinor: number;
}

/** One row of the inventory table: how many rooms of a type exist and are sold on one night. */
export interface NightlyInventory {
  readonly roomTypeId: string;
  readonly date: LocalDate;
  readonly total: number;
  readonly booked: number;
}

export interface RoomTypeAvailability {
  readonly roomType: RoomType;
  /** Rooms still sellable for the *whole* stay: the minimum over its nights. */
  readonly remaining: number;
  readonly nightlyPriceMinor: number;
  readonly totalPriceMinor: number;
}

/** Price of a whole stay in minor units. One place to change when price rules (weekend rates) arrive. */
export function stayTotalPriceMinor(roomType: RoomType, stay: StaySearch): number {
  return roomType.nightlyPriceMinor * stay.nights;
}

/**
 * M5 - availability of every room type for a stay, computed night by night.
 *
 * A room type is offered only if (1) it fits the party, (2) every night of the stay has an
 * inventory row (a missing row means the date is not for sale), and (3) every night still has
 * at least one free room. The reported `remaining` is the minimum over the nights, because a
 * guest needs the *same* room type free on each of them. The check-out date is not a night.
 *
 * @throws DomainError CAPACITY_EXCEEDED when no room type in the hotel can host the party
 */
export function computeAvailability(
  stay: StaySearch,
  roomTypes: readonly RoomType[],
  inventory: readonly NightlyInventory[],
): RoomTypeAvailability[] {
  if (roomTypes.length === 0) return [];

  const largestRoom = Math.max(...roomTypes.map((roomType) => roomType.maxGuests));
  if (stay.guests > largestRoom) {
    throw new DomainError(
      'CAPACITY_EXCEEDED',
      'No room type in this hotel can host that many guests.',
      'rule_violation',
      { guests: stay.guests, maxGuestsPerRoom: largestRoom },
    );
  }

  // roomTypeId -> (night -> rooms still free that night). Rows outside [checkIn, checkOut) are ignored.
  const freeByRoomType = new Map<string, Map<LocalDate, number>>();
  for (const row of inventory) {
    if (row.date < stay.checkIn || row.date >= stay.checkOut) continue;
    let nights = freeByRoomType.get(row.roomTypeId);
    if (nights === undefined) {
      nights = new Map();
      freeByRoomType.set(row.roomTypeId, nights);
    }
    nights.set(row.date, Math.max(0, row.total - row.booked));
  }

  const stayNights = eachNight(stay.checkIn, stay.checkOut);
  const offers: RoomTypeAvailability[] = [];

  for (const roomType of roomTypes) {
    if (roomType.maxGuests < stay.guests) continue;

    const freeByNight = freeByRoomType.get(roomType.id);
    if (freeByNight === undefined) continue;

    let remaining = Number.POSITIVE_INFINITY;
    let everyNightForSale = true;
    for (const night of stayNights) {
      const free = freeByNight.get(night);
      if (free === undefined) {
        everyNightForSale = false;
        break;
      }
      remaining = Math.min(remaining, free);
    }
    if (!everyNightForSale || remaining <= 0) continue;

    offers.push({
      roomType,
      remaining,
      nightlyPriceMinor: roomType.nightlyPriceMinor,
      totalPriceMinor: stayTotalPriceMinor(roomType, stay),
    });
  }

  return offers.sort(
    (a, b) =>
      a.nightlyPriceMinor - b.nightlyPriceMinor || a.roomType.code.localeCompare(b.roomType.code),
  );
}
