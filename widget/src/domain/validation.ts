import type { ConsentInput, GuestInput, SearchInput } from '../api/types.js';
import { addDaysIso, isValidIsoDate, nightsBetween } from './dates.js';

/** Mirrors the server's limits (M2) so the visitor gets instant feedback; the server stays the authority. */
export const LIMITS = Object.freeze({ maxNights: 30, bookingWindowDays: 365, maxAdults: 10, maxChildren: 10 });

export type SearchField = 'checkIn' | 'checkOut' | 'adults' | 'children';
export type SearchErrorKey = 'dateRequired' | 'pastDate' | 'checkOutAfterCheckIn' | 'tooLong' | 'tooFar' | 'adultsRange' | 'childrenRange';

export function validateSearch(input: SearchInput, today: string): Partial<Record<SearchField, SearchErrorKey>> {
  const errors: Partial<Record<SearchField, SearchErrorKey>> = {};

  if (!isValidIsoDate(input.checkIn)) errors.checkIn = 'dateRequired';
  else if (input.checkIn < today) errors.checkIn = 'pastDate';

  if (!isValidIsoDate(input.checkOut)) errors.checkOut = 'dateRequired';
  else if (errors.checkIn === undefined) {
    if (input.checkOut <= input.checkIn) errors.checkOut = 'checkOutAfterCheckIn';
    else if (nightsBetween(input.checkIn, input.checkOut) > LIMITS.maxNights) errors.checkOut = 'tooLong';
    else if (input.checkOut > addDaysIso(today, LIMITS.bookingWindowDays)) errors.checkOut = 'tooFar';
  }

  if (!Number.isInteger(input.adults) || input.adults < 1 || input.adults > LIMITS.maxAdults) errors.adults = 'adultsRange';
  if (!Number.isInteger(input.children) || input.children < 0 || input.children > LIMITS.maxChildren) errors.children = 'childrenRange';
  return errors;
}

export type GuestField = 'firstName' | 'lastName' | 'email' | 'phone' | 'kvkk';
export type GuestErrorKey = 'required' | 'invalidEmail' | 'invalidPhone' | 'kvkkRequired';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateGuest(guest: GuestInput, consents: ConsentInput): Partial<Record<GuestField, GuestErrorKey>> {
  const errors: Partial<Record<GuestField, GuestErrorKey>> = {};
  if (guest.firstName.trim() === '') errors.firstName = 'required';
  if (guest.lastName.trim() === '') errors.lastName = 'required';

  const email = guest.email.trim();
  if (email === '') errors.email = 'required';
  else if (!EMAIL.test(email)) errors.email = 'invalidEmail';

  const phone = guest.phone.trim();
  const digits = phone.replace(/\D/g, '');
  if (phone === '') errors.phone = 'required';
  else if (!/^[+\d\s().-]+$/.test(phone) || digits.length < 8 || digits.length > 15) errors.phone = 'invalidPhone';

  if (!consents.kvkk) errors.kvkk = 'kvkkRequired';
  return errors;
}
