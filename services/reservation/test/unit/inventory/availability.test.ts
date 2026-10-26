import { describe, expect, it } from 'vitest';
import {
  computeAvailability,
  type NightlyInventory,
  type RoomType,
} from '../../../src/modules/inventory/domain/availability.js';
import { createStaySearch } from '../../../src/modules/inventory/domain/stay-search.js';
import { addDays, localDate, type LocalDate } from '../../../src/shared/local-date.js';
import { expectDomainError } from '../../support/domain-error.js';
import { TODAY } from '../../support/fixtures.js';

const standard: RoomType = { id: 'rt-standard', code: 'standard', name: { tr: 'Standart', en: 'Standard' }, maxGuests: 2, nightlyPriceMinor: 320_000 };
const deluxe: RoomType = { id: 'rt-deluxe', code: 'deluxe-sea-view', name: { tr: 'Deluxe Deniz Manzaralı', en: 'Deluxe Sea View' }, maxGuests: 3, nightlyPriceMinor: 480_000 };
const family: RoomType = { id: 'rt-family', code: 'family-suite', name: { tr: 'Aile Suiti', en: 'Family Suite' }, maxGuests: 4, nightlyPriceMinor: 750_000 };
const allRoomTypes = [family, standard, deluxe]; // deliberately unsorted

const CHECK_IN = localDate('2026-11-01');
const CHECK_OUT = localDate('2026-11-04'); // nights: 1st, 2nd, 3rd

function stay(adults = 2, children = 0) {
  return createStaySearch({ checkIn: CHECK_IN, checkOut: CHECK_OUT, adults, children }, TODAY);
}

/** One inventory row per night starting at CHECK_IN; `booked` lists the booked count per night. */
function rows(roomType: RoomType, total: number, booked: number[], from: LocalDate = CHECK_IN): NightlyInventory[] {
  return booked.map((count, index) => ({
    roomTypeId: roomType.id,
    date: addDays(from, index),
    total,
    booked: count,
  }));
}

function allFree(): NightlyInventory[] {
  return [...rows(standard, 20, [0, 0, 0]), ...rows(deluxe, 15, [0, 0, 0]), ...rows(family, 5, [0, 0, 0])];
}

describe('computeAvailability', () => {
  it('offers every room type that fits, cheapest first, with price and rooms left', () => {
    const offers = computeAvailability(stay(2), allRoomTypes, allFree());

    expect(offers.map((offer) => offer.roomType.code)).toEqual(['standard', 'deluxe-sea-view', 'family-suite']);
    expect(offers.map((offer) => offer.remaining)).toEqual([20, 15, 5]);
    expect(offers[0]?.nightlyPriceMinor).toBe(320_000);
    expect(offers[0]?.totalPriceMinor).toBe(960_000); // 3 nights x 3.200 TRY
  });

  it('reports the minimum free rooms over the nights, not the first or the last night', () => {
    const inventory = [...rows(standard, 20, [0, 17, 3]), ...rows(deluxe, 15, [0, 0, 0]), ...rows(family, 5, [0, 0, 0])];
    const standardOffer = computeAvailability(stay(2), allRoomTypes, inventory).find(
      (offer) => offer.roomType.code === 'standard',
    );
    expect(standardOffer?.remaining).toBe(3);
  });

  it('drops a room type that is sold out on any single night of the stay', () => {
    const inventory = [...rows(standard, 20, [0, 20, 0]), ...rows(deluxe, 15, [0, 0, 0]), ...rows(family, 5, [0, 0, 0])];
    const codes = computeAvailability(stay(2), allRoomTypes, inventory).map((offer) => offer.roomType.code);
    expect(codes).toEqual(['deluxe-sea-view', 'family-suite']);
  });

  it('ignores the check-out date: that night is not part of the stay', () => {
    const inventory = [
      ...allFree(),
      // Fully booked on the check-out date itself (4 November).
      { roomTypeId: standard.id, date: CHECK_OUT, total: 20, booked: 20 },
    ];
    const standardOffer = computeAvailability(stay(2), allRoomTypes, inventory).find(
      (offer) => offer.roomType.code === 'standard',
    );
    expect(standardOffer?.remaining).toBe(20);
  });

  it('does not offer a room type when a night has no inventory row (date not for sale)', () => {
    const inventory = [...rows(standard, 20, [0, 0]), ...rows(deluxe, 15, [0, 0, 0]), ...rows(family, 5, [0, 0, 0])];
    const codes = computeAvailability(stay(2), allRoomTypes, inventory).map((offer) => offer.roomType.code);
    expect(codes).toEqual(['deluxe-sea-view', 'family-suite']);
  });

  it('does not offer a room type that has no inventory at all', () => {
    const inventory = [...rows(deluxe, 15, [0, 0, 0]), ...rows(family, 5, [0, 0, 0])];
    const codes = computeAvailability(stay(2), allRoomTypes, inventory).map((offer) => offer.roomType.code);
    expect(codes).toEqual(['deluxe-sea-view', 'family-suite']);
  });

  it('filters by party size: children count toward capacity', () => {
    const twoAdultsOneChild = computeAvailability(stay(2, 1), allRoomTypes, allFree());
    expect(twoAdultsOneChild.map((offer) => offer.roomType.code)).toEqual(['deluxe-sea-view', 'family-suite']);

    const fourGuests = computeAvailability(stay(2, 2), allRoomTypes, allFree());
    expect(fourGuests.map((offer) => offer.roomType.code)).toEqual(['family-suite']);
  });

  it('rejects a party larger than the biggest room in the hotel', () => {
    const error = expectDomainError(() => computeAvailability(stay(4, 1), allRoomTypes, allFree()), 'CAPACITY_EXCEEDED');
    expect(error.details).toEqual({ guests: 5, maxGuestsPerRoom: 4 });
  });

  it('returns nothing (not an error) for a hotel with no room types', () => {
    expect(computeAvailability(stay(2), [], [])).toHaveLength(0);
  });

  it('breaks price ties by room code so the order is stable', () => {
    const a: RoomType = { ...standard, id: 'rt-a', code: 'alpha' };
    const b: RoomType = { ...standard, id: 'rt-b', code: 'beta' };
    const inventory = [...rows(a, 3, [0, 0, 0]), ...rows(b, 3, [0, 0, 0])];
    const codes = computeAvailability(stay(2), [b, a], inventory).map((offer) => offer.roomType.code);
    expect(codes).toEqual(['alpha', 'beta']);
  });
});
