import { resolveLanguage, type Language } from './i18n/index.js';

export interface WidgetConfig {
  hotelKey: string;
  apiBase: string;
  language: Language;
  /** Brand colour for buttons and highlights; null = default. */
  accent: string | null;
  /** Where the hotel's KVKK information notice lives; null = no link. */
  kvkkUrl: string | null;
}

export type ConfigResult = { ok: true; config: WidgetConfig } | { ok: false; problem: string };

const HOTEL_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Only http(s) links: a `javascript:` URL in an attribute must never become a clickable link. */
function safeHttpUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  try {
    const url = new URL(value, document.baseURI);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Reads the `<rota-booking-widget>` attributes. `defaultApiBase` is the origin widget.js was
 * loaded from, so a hotel that serves the script from our API host needs no `api-base`.
 */
export function readConfig(element: Element, defaultApiBase: string, browserLanguages: readonly string[]): ConfigResult {
  const hotelKey = element.getAttribute('hotel-key')?.trim() ?? '';
  if (hotelKey === '') return { ok: false, problem: 'Missing data-hotel-key.' };
  if (!HOTEL_KEY.test(hotelKey)) return { ok: false, problem: 'data-hotel-key is not a valid hotel key.' };

  const apiBase = (element.getAttribute('api-base')?.trim() || defaultApiBase).replace(/\/+$/, '');
  if (safeHttpUrl(apiBase) === null) return { ok: false, problem: 'api-base is not a valid http(s) URL.' };

  const accent = element.getAttribute('accent')?.trim() ?? '';
  return {
    ok: true,
    config: {
      hotelKey,
      apiBase,
      language: resolveLanguage(element.getAttribute('lang'), browserLanguages),
      accent: HEX_COLOR.test(accent) ? accent : null,
      kvkkUrl: safeHttpUrl(element.getAttribute('kvkk-url')),
    },
  };
}
