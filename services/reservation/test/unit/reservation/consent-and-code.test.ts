import { describe, expect, it } from 'vitest';
import { generateReservationCode, RESERVATION_CODE_PATTERN } from '../../../src/modules/reservation/domain/code.js';
import { recordConsents } from '../../../src/modules/reservation/domain/consent.js';
import { expectDomainError } from '../../support/domain-error.js';
import { FIXED_NOW } from '../../support/fixtures.js';

describe('recordConsents', () => {
  it('refuses to book without the KVKK acknowledgement', () => {
    const error = expectDomainError(() => recordConsents({ kvkk: false, marketing: true }, FIXED_NOW), 'KVKK_CONSENT_REQUIRED');
    expect(error.kind).toBe('rule_violation');
  });

  it('keeps marketing optional and independent of KVKK', () => {
    expect(recordConsents({ kvkk: true, marketing: false }, FIXED_NOW)).toEqual({
      kvkkAcceptedAt: FIXED_NOW,
      marketingConsentedAt: null,
    });
  });

  it('timestamps both consents when the guest agrees to both', () => {
    expect(recordConsents({ kvkk: true, marketing: true }, FIXED_NOW)).toEqual({
      kvkkAcceptedAt: FIXED_NOW,
      marketingConsentedAt: FIXED_NOW,
    });
  });
});

describe('generateReservationCode', () => {
  it('uses the RT- prefix and 8 unambiguous characters', () => {
    const code = generateReservationCode(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 255]));
    expect(code).toBe('RT-ABCDEFG9');
    expect(code).toMatch(RESERVATION_CODE_PATTERN);
  });

  it('never produces the confusable characters 0, O, 1, I', () => {
    for (let byte = 0; byte < 256; byte++) {
      const code = generateReservationCode(() => new Uint8Array(8).fill(byte));
      expect(code.slice(3)).not.toMatch(/[01OI]/);
      expect(code).toMatch(RESERVATION_CODE_PATTERN);
    }
  });
});
