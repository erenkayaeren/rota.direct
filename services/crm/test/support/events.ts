import { randomUUID } from 'node:crypto';

export const LAGOS = { id: '11111111-aaaa-4aaa-8aaa-111111111111', key: 'pk_lagos_beach_demo', name: 'Lagos Beach Hotel' };
export const PERI = { id: '22222222-bbbb-4bbb-8bbb-222222222222', key: 'pk_peri_stone_demo', name: 'Peri Stone Cave Hotel' };

export interface EventOptions {
  type?: 'reservation.created' | 'reservation.cancelled';
  hotel?: typeof LAGOS;
  eventId?: string;
  reservationId?: string;
  code?: string;
  version?: number;
  status?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  marketing?: boolean;
  createdAt?: string;
  checkIn?: string;
  checkOut?: string;
  totalPriceMinor?: number;
}

/** An event exactly as the reservation service's relay publishes it (see its `EventEnvelope`). */
export function reservationEvent(options: EventOptions = {}): Record<string, unknown> {
  const hotel = options.hotel ?? LAGOS;
  const reservationId = options.reservationId ?? randomUUID();
  const createdAt = options.createdAt ?? '2026-10-26T12:00:00.000Z';
  const cancelled = options.type === 'reservation.cancelled';
  const version = options.version ?? (cancelled ? 2 : 1);
  const marketing = options.marketing ?? false;
  return {
    eventId: options.eventId ?? randomUUID(),
    type: options.type ?? 'reservation.created',
    occurredAt: createdAt,
    hotelId: hotel.id,
    aggregateId: reservationId,
    version,
    data: {
      hotel,
      reservationId,
      hotelId: hotel.id,
      code: options.code ?? `RT-${reservationId.slice(0, 8).toUpperCase().replace(/[01OI]/g, 'A')}`,
      status: options.status ?? (cancelled ? 'CANCELLED' : 'CONFIRMED'),
      version,
      roomTypeId: '33333333-cccc-4ccc-8ccc-333333333333',
      roomType: { id: '33333333-cccc-4ccc-8ccc-333333333333', code: 'standard', name: { tr: 'Standart', en: 'Standard' } },
      checkIn: options.checkIn ?? '2026-11-10',
      checkOut: options.checkOut ?? '2026-11-13',
      adults: 2,
      children: 0,
      totalPriceMinor: options.totalPriceMinor ?? 960_000,
      currency: 'TRY',
      guest: {
        firstName: options.firstName ?? 'Ayşe',
        lastName: options.lastName ?? 'Yılmaz',
        email: options.email ?? 'ayse@example.com',
        phone: options.phone ?? '+905321234567',
      },
      consents: {
        kvkkAcceptedAt: createdAt,
        marketing,
        marketingConsentedAt: marketing ? createdAt : null,
      },
      createdAt,
      cancelledAt: cancelled ? '2026-10-27T09:00:00.000Z' : null,
    },
  };
}
