import { describe, expect, it } from 'vitest';
import { createGuest, normalizePhone } from '../../../src/modules/reservation/domain/guest.js';
import { expectDomainError } from '../../support/domain-error.js';

const valid = { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '0532 123 45 67' };

describe('createGuest', () => {
  it('trims names, collapses inner spaces, lower-cases the email and normalizes the phone', () => {
    const guest = createGuest({
      firstName: '  Ayşe   Nur ',
      lastName: ' Yılmaz ',
      email: '  Ayse@Example.COM ',
      phone: '0532 123 45 67',
    });
    expect(guest).toEqual({
      firstName: 'Ayşe Nur',
      lastName: 'Yılmaz',
      email: 'ayse@example.com',
      phone: '+905321234567',
    });
  });

  it.each(['', '   '])('rejects an empty name (%j)', (name: string) => {
    expectDomainError(() => createGuest({ ...valid, firstName: name }), 'INVALID_GUEST_NAME');
    expectDomainError(() => createGuest({ ...valid, lastName: name }), 'INVALID_GUEST_NAME');
  });

  it('rejects a name longer than 100 characters', () => {
    expectDomainError(() => createGuest({ ...valid, firstName: 'a'.repeat(101) }), 'INVALID_GUEST_NAME');
  });

  it.each(['no-at-sign', 'a@b', 'a b@example.com', '@example.com', 'a@@example.com'])(
    'rejects the email %j',
    (email: string) => {
      expectDomainError(() => createGuest({ ...valid, email }), 'INVALID_EMAIL');
    },
  );
});

describe('normalizePhone', () => {
  it.each([
    ['0532 123 45 67', '+905321234567'],
    ['532 123 45 67', '+905321234567'],
    ['(0532) 123-45-67', '+905321234567'],
    ['+90 532 123 45 67', '+905321234567'],
    ['0090 532 123 45 67', '+905321234567'],
    ['+44 20 7946 0958', '+442079460958'],
  ])('%s -> %s', (input: string, expected: string) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['', 'abc', '12345', '+90 532 123 45', '+0532123456789', '05321234567890123', '+1'])(
    'rejects %j',
    (input: string) => {
      expectDomainError(() => normalizePhone(input), 'INVALID_PHONE');
    },
  );
});
