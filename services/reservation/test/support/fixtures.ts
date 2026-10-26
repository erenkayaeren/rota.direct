import type { Clock } from '../../src/shared/clock.js';
import { localDate } from '../../src/shared/local-date.js';
import type { Hotel } from '../../src/modules/tenancy/domain/hotel.js';

/** 12:00 UTC on 2026-10-26 = 15:00 in Istanbul, so "today" is 2026-10-26 in both zones. */
export const FIXED_NOW = new Date('2026-10-26T12:00:00Z');
export const TODAY = localDate('2026-10-26');

export function fixedClock(instant: Date = FIXED_NOW): Clock {
  return { now: () => instant };
}

export const LAGOS_ORIGIN = 'https://www.lagosbeachhotel.example';
export const PERI_ORIGIN = 'https://www.peristonecave.example';

export function hotelFixture(overrides: Partial<Hotel> = {}): Hotel {
  return {
    id: 'hotel-lagos',
    publicKey: 'pk_lagos_beach_demo',
    name: 'Lagos Beach Hotel',
    timezone: 'Europe/Istanbul',
    currency: 'TRY',
    allowedOrigins: [LAGOS_ORIGIN, 'http://localhost:8080'],
    ...overrides,
  };
}
