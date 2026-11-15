import { DomainError } from '../../../shared/errors.js';

export const MAX_TAGS_PER_GUEST = 20;
const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,29}$/u;

/** "VIP Guest" -> "vip-guest". Letters (incl. Turkish) and digits only, 1-30 characters. */
export function normalizeTag(raw: string): string {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (!TAG_PATTERN.test(tag)) {
    throw new DomainError(
      'INVALID_TAG',
      'A tag must be 1-30 characters: letters, digits and "-" (spaces become "-").',
      'rule_violation',
      { tag: raw },
    );
  }
  return tag;
}

/** @throws DomainError INVALID_TAG | TOO_MANY_TAGS */
export function normalizeTags(raw: readonly string[]): string[] {
  const tags = [...new Set(raw.map(normalizeTag))].sort();
  if (tags.length > MAX_TAGS_PER_GUEST) {
    throw new DomainError('TOO_MANY_TAGS', `A guest can have at most ${MAX_TAGS_PER_GUEST} tags.`, 'rule_violation');
  }
  return tags;
}
