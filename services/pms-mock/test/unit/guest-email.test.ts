import { describe, expect, it } from 'vitest';
import { buildGuestEmail } from '../../src/mail/guest-email.js';
import { LogMailSender, NotifyGuest, type MailSender } from '../../src/mail/notify-guest.js';
import { PoisonMessageError } from '../../src/shared/errors.js';

const event = (type = 'reservation.created', data: Record<string, unknown> = {}) => ({
  eventId: 'e0d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c11',
  type,
  data: {
    hotel: { id: 'h', key: 'pk', name: 'Lagos Beach Hotel' },
    code: 'RT-ABCDEFGH',
    roomType: { name: { tr: 'Standart', en: 'Standard' } },
    checkIn: '2026-11-10',
    checkOut: '2026-11-13',
    adults: 2,
    children: 0,
    totalPriceMinor: 960_000,
    currency: 'TRY',
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '+905321234567' },
    ...data,
  },
});

describe('buildGuestEmail', () => {
  it('writes a bilingual confirmation to the guest with the code, room, dates and total', () => {
    const email = buildGuestEmail(event());
    expect(email).toMatchObject({ to: 'ayse@example.com', eventId: 'e0d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c11' });
    expect(email?.subject).toBe('Rezervasyonunuz onaylandı / Reservation confirmed - RT-ABCDEFGH');
    expect(email?.text).toContain('Lagos Beach Hotel');
    expect(email?.text).toContain('Standart');
    expect(email?.text).toContain('Standard');
    expect(email?.text).toContain('2026-11-10 → 2026-11-13');
    expect(email?.text).toContain('9.600 TRY');
  });

  it('writes a cancellation notice for cancellations', () => {
    expect(buildGuestEmail(event('reservation.cancelled'))?.subject).toContain('iptal edildi / Reservation cancelled');
  });

  it('sends nothing for other event types, and rejects malformed events as poison', () => {
    expect(buildGuestEmail(event('reservation.checked-in'))).toBeNull();
    expect(() => buildGuestEmail({ nope: true })).toThrow(PoisonMessageError);
    expect(() => buildGuestEmail(event('reservation.created', { guest: undefined }))).toThrow(PoisonMessageError);
  });
});

describe('NotifyGuest', () => {
  it('hands the mail to the sender and lets sender failures propagate (so the consumer retries)', async () => {
    const sent: string[] = [];
    const ok: MailSender = { send: async (m) => void sent.push(m.to) };
    expect(await new NotifyGuest(ok).handle(event())).toBe('sent');
    expect(sent).toEqual(['ayse@example.com']);

    const down: MailSender = { send: async () => { throw new Error('smtp down'); } };
    await expect(new NotifyGuest(down).handle(event())).rejects.toThrow('smtp down');
    expect(await new NotifyGuest(ok).handle(event('reservation.checked-in'))).toBe('ignored');
  });

  it('LogMailSender writes one structured line per mail', async () => {
    const lines: string[] = [];
    await new LogMailSender((l) => lines.push(l)).send({ to: 'a@b.co', subject: 's', text: 't', eventId: 'e' });
    expect(JSON.parse(lines[0] as string)).toMatchObject({ service: 'mail', message: 'email (simulated)', to: 'a@b.co' });
  });
});
