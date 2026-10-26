import { DomainError } from '../../../shared/errors.js';

/** A hotel is the tenant: every request, row and event in the system belongs to exactly one. */
export type HotelId = string;

export interface Hotel {
  readonly id: HotelId;
  /** Public key from the widget's `data-hotel-key` attribute. Identifies the tenant; not a secret. */
  readonly publicKey: string;
  readonly name: string;
  /** IANA zone, e.g. "Europe/Istanbul". Stay dates and "today" are evaluated in this zone. */
  readonly timezone: string;
  /** ISO 4217 code of the prices stored for this hotel. */
  readonly currency: string;
  /** Exact browser origins (scheme + host + port) allowed to call the public API. */
  readonly allowedOrigins: readonly string[];
}

export const HOTEL_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Exact match on purpose: no wildcards, no suffix matching, so "evil-lagos.example" can never pass. */
export function isOriginAllowed(hotel: Hotel, origin: string): boolean {
  return hotel.allowedOrigins.includes(origin);
}

/**
 * Allowed origins are stored exactly as browsers send them in the `Origin` header
 * (lowercase scheme/host, no path, no trailing slash). Validated when written.
 */
export function assertNormalizedOrigin(origin: string): void {
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new RangeError(`Not a valid origin: ${origin}`);
  }
  if (normalized !== origin || normalized === 'null') {
    throw new RangeError(`Origin must be normalized as "${normalized}", got "${origin}"`);
  }
}

export function hotelNotFound(): DomainError {
  return new DomainError('HOTEL_NOT_FOUND', 'Unknown hotel key.', 'not_found');
}

export function originNotAllowed(): DomainError {
  return new DomainError(
    'ORIGIN_NOT_ALLOWED',
    'This origin is not allowed to use the booking API for this hotel.',
    'forbidden',
  );
}
