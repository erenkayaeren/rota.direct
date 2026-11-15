import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '../../../src/modules/guests/domain/email.js';
import { normalizeNote } from '../../../src/modules/guests/domain/notes.js';
import { isNewerVersion, shouldReplaceProfile } from '../../../src/modules/guests/domain/profile.js';
import { normalizeTag, normalizeTags } from '../../../src/modules/guests/domain/tags.js';
import { expectDomainError } from '../../support/domain-error.js';

describe('normalizeEmail', () => {
  it('trims and lower-cases, nothing more', () => {
    expect(normalizeEmail('  Ayse@Example.COM ')).toBe('ayse@example.com');
    // different addresses stay different people (no Gmail dot/plus folding)
    expect(normalizeEmail('a.yse@gmail.com')).not.toBe(normalizeEmail('ayse@gmail.com'));
    expect(normalizeEmail('ayse+x@gmail.com')).not.toBe(normalizeEmail('ayse@gmail.com'));
  });
});

describe('profile rules', () => {
  it('applies a snapshot only when its version is strictly newer', () => {
    expect(isNewerVersion(null, 1)).toBe(true);
    expect(isNewerVersion(1, 2)).toBe(true);
    expect(isNewerVersion(2, 2)).toBe(false);
    expect(isNewerVersion(2, 1)).toBe(false);
  });

  it('lets the newest reservation (by creation time) own the profile', () => {
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-06-01T00:00:00Z');
    expect(shouldReplaceProfile(old, recent)).toBe(true);
    expect(shouldReplaceProfile(recent, recent)).toBe(true);
    expect(shouldReplaceProfile(recent, old)).toBe(false);
  });
});

describe('tags', () => {
  it.each([
    ['VIP', 'vip'],
    ['  Sadık Misafir ', 'sadık-misafir'],
    ['2025-yaz', '2025-yaz'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalizeTag(raw)).toBe(expected);
  });

  it.each(['', '   ', '-vip', 'a'.repeat(31), 'vip!', '<script>'])('rejects %j', (raw) => {
    expectDomainError(() => normalizeTag(raw), 'INVALID_TAG');
  });

  it('de-duplicates, sorts and caps the tag set', () => {
    expect(normalizeTags(['b', 'A', 'a'])).toEqual(['a', 'b']);
    const many = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    expectDomainError(() => normalizeTags(many), 'TOO_MANY_TAGS');
  });
});

describe('notes', () => {
  it('trims and bounds the text', () => {
    expect(normalizeNote('  geç check-in istedi ')).toBe('geç check-in istedi');
    expectDomainError(() => normalizeNote('   '), 'INVALID_NOTE');
    expectDomainError(() => normalizeNote('x'.repeat(2001)), 'INVALID_NOTE');
  });
});
