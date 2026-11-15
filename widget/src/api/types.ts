export interface Money {
  amountMinor: number;
  currency: string;
}

export interface RoomOffer {
  id: string;
  code: string;
  name: { tr: string; en: string };
  maxGuests: number;
  nightlyPrice: Money;
  totalPrice: Money;
  /** Rooms free for the whole stay. */
  remaining: number;
}

export interface AvailabilityResponse {
  stay: { checkIn: string; checkOut: string; nights: number; adults: number; children: number };
  roomTypes: RoomOffer[];
}

export interface SearchInput {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
}

export interface GuestInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface ConsentInput {
  kvkk: boolean;
  marketing: boolean;
}

export interface CreateReservationBody extends SearchInput {
  roomTypeId: string;
  guest: GuestInput;
  consents: ConsentInput;
}

export interface Reservation {
  code: string;
  status: string;
  roomType: { id: string; code: string; name: { tr: string; en: string } };
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  totalPriceMinor: number;
  currency: string;
  guest: GuestInput;
  createdAt: string;
  cancelledAt: string | null;
}
