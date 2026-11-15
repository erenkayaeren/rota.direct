import type { RoomType } from '../../inventory/domain/availability.js';
import type { Hotel } from '../../tenancy/domain/hotel.js';
import type { Reservation } from './reservation.js';

export type ReservationEventType = 'reservation.created' | 'reservation.cancelled';

export interface ReservationEvent {
  readonly type: ReservationEventType;
  readonly payload: Record<string, unknown>;
}

/**
 * The event payload is a full snapshot of the reservation after the change, not a diff:
 * a consumer (the CRM) that sees only the latest event, or sees events out of order and
 * keeps the highest `version`, still ends up with the right state. It contains the guest's
 * personal data because the CRM needs it to build the guest profile; the broker is internal.
 */
function snapshot(reservation: Reservation, hotel: Hotel, roomType: RoomType): Record<string, unknown> {
  return {
    // Lets a consumer (the CRM) label and scope data without ever calling this service back.
    hotel: { id: hotel.id, key: hotel.publicKey, name: hotel.name },
    reservationId: reservation.id,
    hotelId: reservation.hotelId,
    code: reservation.code,
    status: reservation.status,
    version: reservation.version,
    roomTypeId: reservation.roomTypeId,
    roomType: { id: roomType.id, code: roomType.code, name: roomType.name },
    checkIn: reservation.checkIn,
    checkOut: reservation.checkOut,
    adults: reservation.adults,
    children: reservation.children,
    totalPriceMinor: reservation.totalPriceMinor,
    currency: reservation.currency,
    guest: {
      firstName: reservation.guest.firstName,
      lastName: reservation.guest.lastName,
      email: reservation.guest.email,
      phone: reservation.guest.phone,
    },
    consents: {
      kvkkAcceptedAt: reservation.kvkkAcceptedAt.toISOString(),
      marketing: reservation.marketingConsentedAt !== null,
      marketingConsentedAt: reservation.marketingConsentedAt?.toISOString() ?? null,
    },
    createdAt: reservation.createdAt.toISOString(),
    cancelledAt: reservation.cancelledAt?.toISOString() ?? null,
  };
}

export function reservationCreated(reservation: Reservation, hotel: Hotel, roomType: RoomType): ReservationEvent {
  return { type: 'reservation.created', payload: snapshot(reservation, hotel, roomType) };
}

export function reservationCancelled(reservation: Reservation, hotel: Hotel, roomType: RoomType): ReservationEvent {
  return { type: 'reservation.cancelled', payload: snapshot(reservation, hotel, roomType) };
}
