import { diffDays, type LocalDate } from '../../../shared/local-date.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { Guest } from './guest.js';
import type { ReservationStatus } from './status.js';

export interface Reservation {
  readonly id: string;
  readonly hotelId: HotelId;
  readonly roomTypeId: string;
  readonly code: string;
  readonly status: ReservationStatus;
  readonly checkIn: LocalDate;
  readonly checkOut: LocalDate;
  readonly adults: number;
  readonly children: number;
  readonly totalPriceMinor: number;
  readonly currency: string;
  readonly guest: Guest;
  readonly kvkkAcceptedAt: Date;
  readonly marketingConsentedAt: Date | null;
  /** Starts at 1 and grows with every state change; orders the events of one reservation. */
  readonly version: number;
  readonly createdAt: Date;
  readonly cancelledAt: Date | null;
}

/** What the use case decides; the database adds id and version. */
export type NewReservation = Omit<Reservation, 'id' | 'version' | 'cancelledAt'>;

export function nightsOf(reservation: Pick<Reservation, 'checkIn' | 'checkOut'>): number {
  return diffDays(reservation.checkIn, reservation.checkOut);
}
