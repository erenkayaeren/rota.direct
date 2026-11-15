import { ELEMENT_NAME, RotaBookingWidget } from './element.js';

/** `data-*` attributes of the <script> tag that map onto the element's attributes. */
const SCRIPT_ATTRIBUTES: Record<string, string> = {
  'data-hotel-key': 'hotel-key',
  'data-lang': 'lang',
  'data-api-base': 'api-base',
  'data-accent': 'accent',
  'data-kvkk-url': 'kvkk-url',
};

export function findOwnScript(): HTMLScriptElement | null {
  const current = document.currentScript;
  if (current instanceof HTMLScriptElement && current.hasAttribute('data-hotel-key')) return current;
  // `currentScript` is null when the file is injected as a module or evaluated late.
  return document.querySelector<HTMLScriptElement>('script[data-hotel-key][src*="widget"]');
}

export function mountFromScriptTag(script: HTMLScriptElement): void {
  if (script.dataset['rotaMounted'] === 'true') return;
  script.dataset['rotaMounted'] = 'true';

  try {
    RotaBookingWidget.defaultApiBase = new URL(script.src).origin;
  } catch {
    /* inline or blob script: fall back to the page origin */
  }

  const element = document.createElement(ELEMENT_NAME);
  for (const [from, to] of Object.entries(SCRIPT_ATTRIBUTES)) {
    const value = script.getAttribute(from);
    if (value !== null) element.setAttribute(to, value);
  }

  const targetSelector = script.getAttribute('data-target');
  const target = targetSelector ? document.querySelector(targetSelector) : null;
  if (target) target.append(element);
  else script.insertAdjacentElement('afterend', element);
}
