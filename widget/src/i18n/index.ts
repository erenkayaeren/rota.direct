import { en } from './en.js';
import type { Language, Messages } from './messages.js';
import { tr } from './tr.js';

export type { Language, Messages };
export const LANGUAGES: readonly Language[] = ['tr', 'en'];
const BY_LANGUAGE: Record<Language, Messages> = { tr, en };

export function messagesFor(language: Language): Messages {
  return BY_LANGUAGE[language];
}

/** `data-lang`: "tr", "en" or "auto" (follow the visitor's browser; anything unknown falls back to Turkish). */
export function resolveLanguage(setting: string | null | undefined, browserLanguages: readonly string[]): Language {
  const wanted = (setting ?? 'auto').trim().toLowerCase();
  if (wanted === 'tr' || wanted === 'en') return wanted;
  for (const candidate of browserLanguages) {
    const base = candidate.toLowerCase().split('-')[0];
    if (base === 'tr' || base === 'en') return base;
  }
  return 'tr';
}

/** The visitor-facing text for a server error code. */
export function errorMessage(messages: Messages, code: string | undefined): string {
  if (code === undefined) return messages.errors.generic;
  return messages.errors[code] ?? messages.errors.generic;
}
