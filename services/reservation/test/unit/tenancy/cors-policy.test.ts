import { describe, expect, it } from 'vitest';
import {
  CORS_ALLOWED_HEADERS,
  CORS_ALLOWED_METHODS,
  decideCors,
} from '../../../src/modules/tenancy/http/cors-policy.js';
import { hotelFixture, LAGOS_ORIGIN, PERI_ORIGIN } from '../../support/fixtures.js';

const lagos = hotelFixture();

describe('decideCors', () => {
  it('lets requests without an Origin header through (not a browser CORS request)', () => {
    const decision = decideCors(lagos, undefined, false);
    expect(decision.action).toBe('proceed');
    expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('echoes an allowed origin and marks the response as varying by Origin', () => {
    const decision = decideCors(lagos, LAGOS_ORIGIN, false);
    expect(decision.action).toBe('proceed');
    expect(decision.headers['Access-Control-Allow-Origin']).toBe(LAGOS_ORIGIN);
    expect(decision.headers['Vary']).toBe('Origin');
    expect(decision.headers['Access-Control-Allow-Methods']).toBeUndefined();
  });

  it("rejects another hotel's origin, without granting access", () => {
    const decision = decideCors(lagos, PERI_ORIGIN, false);
    expect(decision.action).toBe('reject');
    expect(decision.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('adds method, header and max-age answers to preflight responses only', () => {
    const decision = decideCors(lagos, LAGOS_ORIGIN, true);
    expect(decision.headers['Access-Control-Allow-Methods']).toBe(CORS_ALLOWED_METHODS);
    expect(decision.headers['Access-Control-Allow-Headers']).toBe(CORS_ALLOWED_HEADERS);
    expect(decision.headers['Access-Control-Max-Age']).toBe('600');
  });

  it('allows the Idempotency-Key header that reservation requests send', () => {
    expect(CORS_ALLOWED_HEADERS).toContain('Idempotency-Key');
  });

  it('lets the widget read the Idempotent-Replayed response header', () => {
    expect(decideCors(lagos, LAGOS_ORIGIN, false).headers['Access-Control-Expose-Headers']).toBe('Idempotent-Replayed');
  });

  it('rejects a preflight from a disallowed origin too', () => {
    expect(decideCors(lagos, 'https://evil.example', true).action).toBe('reject');
  });
});
