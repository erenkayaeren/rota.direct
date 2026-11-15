import { describe, expect, it } from 'vitest';
import { NotifyPms } from '../../src/notifier/notify-pms.js';
import type { PmsClient } from '../../src/notifier/pms-client.js';
import type { PmsReservation } from '../../src/pms/pms-app.js';
import { PoisonMessageError } from '../../src/shared/errors.js';

const event = (overrides: Record<string, unknown> = {}, dataOverrides: Record<string, unknown> = {}) => ({
  eventId: 'e0d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c11',
  type: 'reservation.created',
  occurredAt: '2026-10-26T12:00:00.000Z',
  hotelId: 'h',
  aggregateId: 'a',
  version: 1,
  data: {
    hotel: { id: 'h', key: 'pk_lagos_beach_demo', name: 'Lagos' },
    code: 'RT-ABCDEFGH',
    status: 'CONFIRMED',
    version: 1,
    roomType: { id: 'r', code: 'standard', name: { tr: 'Standart', en: 'Standard' } },
    checkIn: '2026-11-10',
    checkOut: '2026-11-13',
    adults: 2,
    children: 0,
    totalPriceMinor: 960000,
    currency: 'TRY',
    guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '+905321234567' },
    consents: { kvkkAcceptedAt: '2026-10-26T12:00:00.000Z', marketing: true, marketingConsentedAt: '2026-10-26T12:00:00.000Z' },
    ...dataOverrides,
  },
  ...overrides,
});

class FakePms implements PmsClient {
  readonly calls: Array<{ code: string; reservation: PmsReservation; key: string }> = [];
  error: Error | undefined;
  async upsert(code: string, reservation: PmsReservation, key: string): Promise<void> {
    this.calls.push({ code, reservation, key });
    if (this.error) throw this.error;
  }
}

describe('NotifyPms', () => {
  it('sends the stay to the PMS, with the event id as idempotency key and WITHOUT marketing consent', async () => {
    const pms = new FakePms();
    expect(await new NotifyPms(pms).handle(event())).toBe('sent');
    expect(pms.calls).toHaveLength(1);
    expect(pms.calls[0]).toEqual({
      code: 'RT-ABCDEFGH',
      key: 'e0d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c11',
      reservation: {
        hotelKey: 'pk_lagos_beach_demo',
        status: 'CONFIRMED',
        version: 1,
        guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '+905321234567' },
        stay: { checkIn: '2026-11-10', checkOut: '2026-11-13', adults: 2, children: 0, roomTypeCode: 'standard' },
        totalPriceMinor: 960000,
        currency: 'TRY',
      },
    });
    expect(JSON.stringify(pms.calls[0])).not.toContain('marketing');
  });

  it('also tells the PMS about cancellations', async () => {
    const pms = new FakePms();
    await new NotifyPms(pms).handle(event({ type: 'reservation.cancelled' }, { status: 'CANCELLED', version: 2 }));
    expect(pms.calls[0]?.reservation).toMatchObject({ status: 'CANCELLED', version: 2 });
  });

  it('ignores event types the PMS does not care about', async () => {
    const pms = new FakePms();
    expect(await new NotifyPms(pms).handle(event({ type: 'reservation.checked-in' }))).toBe('ignored');
    expect(pms.calls).toHaveLength(0);
  });

  it('treats a broken event as poison and does not call the PMS', async () => {
    const pms = new FakePms();
    await expect(new NotifyPms(pms).handle({ hello: 'world' })).rejects.toBeInstanceOf(PoisonMessageError);
    await expect(new NotifyPms(pms).handle(event({}, { guest: undefined }))).rejects.toBeInstanceOf(PoisonMessageError);
    expect(pms.calls).toHaveLength(0);
  });

  it('lets PMS failures propagate so the consumer can retry', async () => {
    const pms = new FakePms();
    pms.error = new Error('PMS answered 503');
    await expect(new NotifyPms(pms).handle(event())).rejects.toThrow('503');
  });
});
