import { z } from 'zod';
import { PoisonMessageError } from '../shared/errors.js';

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  /** The event that caused it: a real mail provider would receive it as its idempotency key. */
  readonly eventId: string;
}

const envelopeSchema = z.object({ eventId: z.string().uuid(), type: z.string(), data: z.unknown() });
const dataSchema = z.object({
  hotel: z.object({ name: z.string().min(1) }),
  code: z.string().min(1),
  roomType: z.object({ name: z.object({ tr: z.string(), en: z.string() }) }),
  checkIn: z.string(),
  checkOut: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  totalPriceMinor: z.number().int(),
  currency: z.string().length(3),
  guest: z.object({ firstName: z.string(), lastName: z.string(), email: z.string().min(3) }),
});

const money = (minor: number, currency: string): string =>
  `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100)} ${currency}`;

/**
 * The booking confirmation / cancellation mail. The event carries no language preference, so the
 * mail is bilingual (Turkish first). Returns null for events that need no mail.
 * @throws PoisonMessageError for a malformed event
 */
export function buildGuestEmail(raw: unknown): Email | null {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) throw new PoisonMessageError('Invalid event envelope');
  const type = envelope.data.type;
  if (type !== 'reservation.created' && type !== 'reservation.cancelled') return null;

  const parsed = dataSchema.safeParse(envelope.data.data);
  if (!parsed.success) throw new PoisonMessageError(`Invalid ${type} payload`);
  const r = parsed.data;
  const name = `${r.guest.firstName} ${r.guest.lastName}`;
  const stay = `${r.checkIn} → ${r.checkOut}`;
  const total = money(r.totalPriceMinor, r.currency);

  if (type === 'reservation.created') {
    return {
      to: r.guest.email,
      eventId: envelope.data.eventId,
      subject: `Rezervasyonunuz onaylandı / Reservation confirmed - ${r.code}`,
      text: [
        `Sayın ${name},`,
        `${r.hotel.name} için rezervasyonunuz onaylandı. Rezervasyon kodunuz: ${r.code}`,
        `Oda: ${r.roomType.name.tr} · Tarih: ${stay} · Toplam: ${total} (ödeme otelde)`,
        'İptal için rezervasyon kodunuza ve bu e-posta adresine ihtiyacınız olacak.',
        '',
        `Dear ${name},`,
        `Your reservation at ${r.hotel.name} is confirmed. Reservation code: ${r.code}`,
        `Room: ${r.roomType.name.en} · Dates: ${stay} · Total: ${total} (payable at the hotel)`,
        'To cancel you will need your reservation code and this email address.',
      ].join('\n'),
    };
  }
  return {
    to: r.guest.email,
    eventId: envelope.data.eventId,
    subject: `Rezervasyonunuz iptal edildi / Reservation cancelled - ${r.code}`,
    text: [
      `Sayın ${name}, ${r.hotel.name} için ${r.code} kodlu rezervasyonunuz iptal edildi (${stay}).`,
      `Dear ${name}, your reservation ${r.code} at ${r.hotel.name} (${stay}) has been cancelled.`,
    ].join('\n'),
  };
}
