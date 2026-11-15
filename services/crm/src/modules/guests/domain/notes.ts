import { DomainError } from '../../../shared/errors.js';

export const MAX_NOTE_LENGTH = 2000;

/** @throws DomainError INVALID_NOTE */
export function normalizeNote(raw: string): string {
  const body = raw.trim();
  if (body.length === 0 || body.length > MAX_NOTE_LENGTH) {
    throw new DomainError('INVALID_NOTE', `A note must be 1-${MAX_NOTE_LENGTH} characters.`, 'rule_violation');
  }
  return body;
}
