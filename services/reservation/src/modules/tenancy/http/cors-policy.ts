import { isOriginAllowed, type Hotel } from '../domain/hotel.js';

export const CORS_ALLOWED_METHODS = 'GET, POST, OPTIONS';
export const CORS_ALLOWED_HEADERS = 'Content-Type, Idempotency-Key, Accept-Language';
export const CORS_PREFLIGHT_MAX_AGE_SECONDS = 600;

export interface CorsDecision {
  /** `reject` means the browser origin is not on this hotel's allow-list: answer 403. */
  action: 'proceed' | 'reject';
  /** Headers to put on the response in either case. */
  headers: Record<string, string>;
}

/**
 * Per-tenant CORS. The allow-list is the hotel's own, so a page on one hotel's domain
 * cannot use another hotel's key from a browser. Pure function: no framework types.
 *
 * Requests without an Origin header (curl, server-to-server, same-origin GET) are not CORS
 * requests and pass: CORS protects visitors' browsers, it is not authentication (the hotel
 * key is public by design).
 */
export function decideCors(hotel: Hotel, origin: string | undefined, preflight: boolean): CorsDecision {
  // The response differs by Origin, so caches must key on it.
  const headers: Record<string, string> = { Vary: 'Origin' };

  if (origin === undefined) return { action: 'proceed', headers };
  if (!isOriginAllowed(hotel, origin)) return { action: 'reject', headers };

  headers['Access-Control-Allow-Origin'] = origin;
  if (preflight) {
    headers['Access-Control-Allow-Methods'] = CORS_ALLOWED_METHODS;
    headers['Access-Control-Allow-Headers'] = CORS_ALLOWED_HEADERS;
    headers['Access-Control-Max-Age'] = String(CORS_PREFLIGHT_MAX_AGE_SECONDS);
  }
  return { action: 'proceed', headers };
}
