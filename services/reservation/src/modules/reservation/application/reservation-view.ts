import type { RoomType } from '../../inventory/domain/availability.js';
import { nightsOf, type Reservation } from '../domain/reservation.js';

/** The public representation of a reservation, as the widget receives it. */
export interface ReservationView {
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
  guest: { firstName: string; lastName: string; email: string; phone: string };
  marketingConsent: boolean;
  createdAt: string;
  cancelledAt: string | null;
}

export function toReservationView(reservation: Reservation, roomType: RoomType): ReservationView {
  return {
    code: reservation.code,
    status: reservation.status,
    roomType: { id: roomType.id, code: roomType.code, name: roomType.name },
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    nights: nightsOf(reservation),
    adults: reservation.adults,
    children: reservation.children,
    totalPriceMinor: reservation.totalPriceMinor,
    currency: reservation.currency,
    guest: { ...reservation.guest },
    marketingConsent: reservation.marketingConsentedAt !== null,
    createdAt: reservation.createdAt.toISOString(),
    cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
  };
}
