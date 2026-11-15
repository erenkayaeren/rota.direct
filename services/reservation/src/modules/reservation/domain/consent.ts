import { DomainError } from '../../../shared/errors.js';

export interface ConsentInput {
  /** Acknowledgement of the KVKK (Turkish data protection) information notice. Required to book. */
  kvkk: boolean;
  /** Permission to send marketing messages. Optional and never pre-ticked by the widget. */
  marketing: boolean;
}

export interface Consents {
  readonly kvkkAcceptedAt: Date;
  /** null = the guest did not agree to marketing. */
  readonly marketingConsentedAt: Date | null;
}

/**
 * The two consents are separate on purpose: processing the booking needs the notice
 * acknowledged, while marketing needs explicit, optional permission. Both are stored with
 * their timestamp so the hotel can later show when and what the guest agreed to.
 *
 * @throws DomainError KVKK_CONSENT_REQUIRED
 */
export function recordConsents(input: ConsentInput, now: Date): Consents {
  if (!input.kvkk) {
    throw new DomainError(
      'KVKK_CONSENT_REQUIRED',
      'The KVKK information notice must be acknowledged to make a reservation.',
      'rule_violation',
      { field: 'consents.kvkk' },
    );
  }
  return { kvkkAcceptedAt: now, marketingConsentedAt: input.marketing ? now : null };
}
