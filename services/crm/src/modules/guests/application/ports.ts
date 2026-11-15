import type { ReservationEvent, ReservationSnapshot } from './event-contract.js';

/** Everything the projection writes, bound to one database transaction. */
export interface ProjectionTx {
  /** Records the event id in the inbox. False = already handled (a redelivery). */
  claimEvent(eventId: string, eventType: string): Promise<boolean>;
  upsertHotel(hotel: ReservationSnapshot['hotel']): Promise<void>;
  /** Finds the guest by (hotel, email) or creates it; refreshes contact/consent per the as-of rule. Returns the guest id. */
  upsertGuest(reservation: ReservationSnapshot, email: string): Promise<string>;
  /** Stores the snapshot unless a version >= this one is already stored. Returns whether it was applied. */
  upsertReservation(guestId: string, reservation: ReservationSnapshot, eventId: string): Promise<boolean>;
}

export interface ProjectionStore {
  run<T>(work: (tx: ProjectionTx) => Promise<T>): Promise<T>;
}

export interface GuestListQuery {
  readonly q: string | undefined;
  readonly tag: string | undefined;
  readonly marketing: boolean | undefined;
  readonly sort: 'recent' | 'name' | 'spend';
  readonly page: number;
  readonly pageSize: number;
}

export interface GuestStats {
  readonly reservations: number;
  readonly cancelled: number;
  readonly nights: number;
  readonly spentMinor: number;
  readonly currency: string | null;
  readonly lastCheckIn: string | null;
}

export interface GuestSummary {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly marketingConsent: boolean;
  readonly tags: readonly string[];
  readonly stats: GuestStats;
  readonly lastSeenAt: string;
}

export interface GuestReservationView {
  readonly code: string;
  readonly status: string;
  readonly version: number;
  readonly roomType: { readonly code: string; readonly name: { readonly tr: string; readonly en: string } };
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
  readonly adults: number;
  readonly children: number;
  readonly totalPriceMinor: number;
  readonly currency: string;
  readonly bookedAt: string;
  readonly cancelledAt: string | null;
}

export interface GuestNoteView {
  readonly id: string;
  readonly body: string;
  readonly author: string;
  readonly createdAt: string;
}

export interface GuestDetail extends GuestSummary {
  readonly kvkkAcceptedAt: string;
  readonly marketingConsentedAt: string | null;
  readonly createdAt: string;
  readonly reservations: readonly GuestReservationView[];
  readonly notes: readonly GuestNoteView[];
  /** Other guests of this hotel with the same phone number: shown as a hint, never merged automatically. */
  readonly possibleDuplicates: ReadonlyArray<{ id: string; firstName: string; lastName: string; email: string }>;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/** Read and staff-write side. Every method is scoped to one hotel. */
export interface GuestRepository {
  search(hotelId: string, query: GuestListQuery): Promise<Page<GuestSummary>>;
  findDetail(hotelId: string, guestId: string): Promise<GuestDetail | null>;
  /** Null when the guest does not exist in this hotel. */
  addNote(hotelId: string, guestId: string, body: string, author: string): Promise<GuestNoteView | null>;
  /** Replaces the whole tag set. Null when the guest does not exist in this hotel. */
  replaceTags(hotelId: string, guestId: string, tags: readonly string[]): Promise<string[] | null>;
}

export type { ReservationEvent, ReservationSnapshot };
