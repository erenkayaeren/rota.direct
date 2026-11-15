import { describe, expect, it } from 'vitest';
import { parseEvent } from '../../../src/modules/guests/application/event-contract.js';
import { PoisonMessageError } from '../../../src/shared/errors.js';
import { reservationEvent } from '../../support/events.js';

describe('parseEvent (consumer side of the event contract)', () => {
  it('parses a created event into a typed snapshot with real dates', () => {
    const parsed = parseEvent(reservationEvent({ marketing: true }));
    expect(parsed.kind).toBe('reservation');
    if (parsed.kind !== 'reservation') return;
    expect(parsed.event.type).toBe('reservation.created');
    expect(parsed.event.reservation.createdAt).toBeInstanceOf(Date);
    expect(parsed.event.reservation.consents.marketingConsentedAt).toBeInstanceOf(Date);
    expect(parsed.event.reservation.guest.email).toBe('ayse@example.com');
  });

  it('ignores event types it does not handle instead of failing (forward compatibility)', () => {
    expect(parseEvent({ ...reservationEvent(), type: 'reservation.checked-in' })).toEqual({
      kind: 'ignored',
      type: 'reservation.checked-in',
    });
  });

  it('is a tolerant reader: unknown extra fields are fine', () => {
    const event = reservationEvent() as { data: Record<string, unknown> };
    event.data['loyaltyTier'] = 'gold';
    expect(parseEvent(event).kind).toBe('reservation');
  });

  it.each([
    ['not an object', 'hello'],
    ['missing event id', { ...reservationEvent(), eventId: undefined }],
    ['event id not a uuid', { ...reservationEvent(), eventId: 'abc' }],
    ['version 0', { ...reservationEvent(), version: 0 }],
  ])('rejects a broken envelope (%s) as poison', (_name, raw) => {
    expect(() => parseEvent(raw)).toThrow(PoisonMessageError);
  });

  it('rejects a payload that breaks the contract as poison', () => {
    const event = reservationEvent() as { data: { guest: Record<string, unknown> } };
    delete event.data.guest['email'];
    expect(() => parseEvent(event)).toThrow(PoisonMessageError);
  });

  it('rejects an envelope that disagrees with its payload about the reservation', () => {
    expect(() => parseEvent({ ...reservationEvent(), aggregateId: '99999999-9999-4999-8999-999999999999' })).toThrow(
      /disagree/,
    );
  });
});
