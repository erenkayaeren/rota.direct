import type { AvailabilityResult } from '../application/search-availability.js';

export interface Money {
  /** Integer minor units (kurus for TRY). Never a float. */
  amountMinor: number;
  currency: string;
}

export interface AvailabilityResponse {
  stay: { checkIn: string; checkOut: string; nights: number; adults: number; children: number };
  roomTypes: Array<{
    id: string;
    code: string;
    name: { tr: string; en: string };
    maxGuests: number;
    nightlyPrice: Money;
    totalPrice: Money;
    /** Rooms still free for the whole stay (minimum over its nights). */
    remaining: number;
  }>;
}

export function toAvailabilityResponse(result: AvailabilityResult): AvailabilityResponse {
  const { stay, currency } = result;
  return {
    stay: {
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: stay.nights,
      adults: stay.adults,
      children: stay.children,
    },
    roomTypes: result.roomTypes.map((offer) => ({
      id: offer.roomType.id,
      code: offer.roomType.code,
      name: { tr: offer.roomType.name.tr, en: offer.roomType.name.en },
      maxGuests: offer.roomType.maxGuests,
      nightlyPrice: { amountMinor: offer.nightlyPriceMinor, currency },
      totalPrice: { amountMinor: offer.totalPriceMinor, currency },
      remaining: offer.remaining,
    })),
  };
}
