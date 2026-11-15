import { z } from 'zod';
import { PoisonMessageError } from '../../../shared/errors.js';

/**
 * What this service expects from the reservation service's events. It is a *tolerant reader*:
 * fields it does not know are ignored, so the producer can add fields without breaking the
 * consumer (ADR-0006). Anything that violates this contract is a poison message.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timestamp = z.string().datetime({ offset: true }).transform((value) => new Date(value));

const envelopeSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
  hotelId: z.string().uuid(),
  aggregateId: z.string().uuid(),
  version: z.number().int().positive(),
  data: z.unknown(),
});

const reservationDataSchema = z.object({
  hotel: z.object({ id: z.string().uuid(), key: z.string().min(1), name: z.string().min(1) }),
  reservationId: z.string().uuid(),
  code: z.string().min(1),
  status: z.string().min(1),
  version: z.number().int().positive(),
  roomType: z.object({
    id: z.string().uuid(),
    code: z.string().min(1),
    name: z.object({ tr: z.string(), en: z.string() }),
  }),
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.number().int(),
  children: z.number().int(),
  totalPriceMinor: z.number().int(),
  currency: z.string().length(3),
  guest: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().min(3),
    phone: z.string().min(1),
  }),
  consents: z.object({
    kvkkAcceptedAt: timestamp,
    marketing: z.boolean(),
    marketingConsentedAt: timestamp.nullable(),
  }),
  createdAt: timestamp,
  cancelledAt: timestamp.nullable(),
});

export type ReservationSnapshot = z.infer<typeof reservationDataSchema>;

export const HANDLED_EVENT_TYPES = ['reservation.created', 'reservation.cancelled'] as const;

export interface ReservationEvent {
  readonly eventId: string;
  readonly type: (typeof HANDLED_EVENT_TYPES)[number];
  readonly occurredAt: string;
  readonly reservation: ReservationSnapshot;
}

export type ParsedEvent = { readonly kind: 'reservation'; readonly event: ReservationEvent } | { readonly kind: 'ignored'; readonly type: string };

/** @throws PoisonMessageError when the message breaks the contract */
export function parseEvent(raw: unknown): ParsedEvent {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new PoisonMessageError(`Invalid event envelope: ${envelope.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const { type } = envelope.data;
  if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(type)) return { kind: 'ignored', type };

  const data = reservationDataSchema.safeParse(envelope.data.data);
  if (!data.success) {
    throw new PoisonMessageError(`Invalid ${type} payload: ${data.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  if (data.data.reservationId !== envelope.data.aggregateId || data.data.hotel.id !== envelope.data.hotelId) {
    throw new PoisonMessageError('Event envelope and payload disagree about reservation or hotel');
  }
  return {
    kind: 'reservation',
    event: {
      eventId: envelope.data.eventId,
      type: type as ReservationEvent['type'],
      occurredAt: envelope.data.occurredAt,
      reservation: data.data,
    },
  };
}
