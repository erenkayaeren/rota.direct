import { z } from 'zod';
import { PoisonMessageError } from '../shared/errors.js';
import type { PmsReservation } from '../pms/pms-app.js';
import type { PmsClient } from './pms-client.js';

// Tolerant reader: only the fields the PMS needs; anything else in the event is ignored.
const envelopeSchema = z.object({
  eventId: z.string().uuid(),
  type: z.string(),
  data: z.unknown(),
});
const dataSchema = z.object({
  hotel: z.object({ key: z.string().min(1) }),
  code: z.string().min(1),
  status: z.string(),
  version: z.number().int().positive(),
  roomType: z.object({ code: z.string().min(1) }),
  checkIn: z.string(),
  checkOut: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  totalPriceMinor: z.number().int(),
  currency: z.string().length(3),
  guest: z.object({ firstName: z.string(), lastName: z.string(), email: z.string(), phone: z.string() }),
});

const NOTIFIED_TYPES = new Set(['reservation.created', 'reservation.cancelled']);

export type NotifyOutcome = 'sent' | 'ignored';

/**
 * Tells the PMS about a reservation (created or cancelled). What the PMS gets is only what it
 * needs to run the stay: marketing consent is deliberately NOT sent (data minimisation).
 * The event id doubles as the PMS idempotency key, so at-least-once delivery cannot duplicate.
 */
export class NotifyPms {
  constructor(private readonly pms: PmsClient) {}

  /** @throws PoisonMessageError if the event is malformed or the PMS rejects it for good */
  async handle(raw: unknown): Promise<NotifyOutcome> {
    const envelope = envelopeSchema.safeParse(raw);
    if (!envelope.success) throw new PoisonMessageError('Invalid event envelope');
    if (!NOTIFIED_TYPES.has(envelope.data.type)) return 'ignored';

    const data = dataSchema.safeParse(envelope.data.data);
    if (!data.success) {
      throw new PoisonMessageError(`Invalid ${envelope.data.type} payload: ${data.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    }
    const reservation = data.data;
    if (reservation.status !== 'CONFIRMED' && reservation.status !== 'CANCELLED') return 'ignored';

    const payload: PmsReservation = {
      hotelKey: reservation.hotel.key,
      status: reservation.status,
      version: reservation.version,
      guest: reservation.guest,
      stay: {
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        adults: reservation.adults,
        children: reservation.children,
        roomTypeCode: reservation.roomType.code,
      },
      totalPriceMinor: reservation.totalPriceMinor,
      currency: reservation.currency,
    };
    await this.pms.upsert(reservation.code, payload, envelope.data.eventId);
    return 'sent';
  }
}
