import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, NetworkError, type ApiClient } from '../src/api/client.js';
import type { AvailabilityResponse, Reservation, RoomOffer } from '../src/api/types.js';
import { mountFromScriptTag } from '../src/bootstrap.js';
import { defineWidgetElement, ELEMENT_NAME, RotaBookingWidget } from '../src/element.js';

const room = (id: string, code: string, name: string, remaining: number, nightly: number, nights = 2): RoomOffer => ({
  id, code, name: { tr: `${name} TR`, en: name }, maxGuests: 3,
  nightlyPrice: { amountMinor: nightly, currency: 'TRY' }, totalPrice: { amountMinor: nightly * nights, currency: 'TRY' }, remaining,
});
const availability = (rooms: RoomOffer[]): AvailabilityResponse => ({
  stay: { checkIn: '2030-01-10', checkOut: '2030-01-12', nights: 2, adults: 2, children: 0 }, roomTypes: rooms,
});
const reservation: Reservation = {
  code: 'RT-ABCDEFGH', status: 'CONFIRMED', roomType: { id: 'r1', code: 'standard', name: { tr: 'Standart TR', en: 'Standard' } },
  checkIn: '2030-01-10', checkOut: '2030-01-12', nights: 2, adults: 2, children: 0, totalPriceMinor: 640_000, currency: 'TRY',
  guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '+905321234567' }, createdAt: '2026-10-26T12:00:00.000Z', cancelledAt: null,
};

interface FakeClient extends ApiClient {
  availability: ReturnType<typeof vi.fn>;
  createReservation: ReturnType<typeof vi.fn>;
  cancelReservation: ReturnType<typeof vi.fn>;
}
function fakeClient(): FakeClient {
  return {
    availability: vi.fn(async () => availability([room('r1', 'standard', 'Standard', 8, 320_000), room('r2', 'family', 'Family Suite', 2, 750_000)])),
    createReservation: vi.fn(async () => ({ reservation, replayed: false })),
    cancelReservation: vi.fn(async () => ({ ...reservation, status: 'CANCELLED' })),
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

let client: FakeClient;
let widget: HTMLElement;
const $ = <T extends Element = HTMLElement>(selector: string): T => {
  const found = widget.shadowRoot?.querySelector<T>(selector);
  if (!found) throw new Error(`Not found in widget: ${selector}\n${widget.shadowRoot?.innerHTML.slice(0, 600)}`);
  return found;
};
const maybe = (selector: string): Element | null => widget.shadowRoot?.querySelector(selector) ?? null;
const text = (): string => widget.shadowRoot?.textContent ?? '';
const type = async (selector: string, value: string): Promise<void> => {
  const input = $<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
};
const check = async (selector: string): Promise<void> => {
  $<HTMLInputElement>(selector).click();
  await flush();
};
const buttonByText = (label: string): HTMLButtonElement => {
  const found = [...(widget.shadowRoot?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === label);
  if (!found) throw new Error(`No button "${label}" in: ${text().slice(0, 400)}`);
  return found;
};
const press = async (label: string): Promise<void> => {
  buttonByText(label).click();
  await flush();
};

function mount(attributes: Record<string, string> = { 'hotel-key': 'pk_lagos_beach_demo', lang: 'en' }): HTMLElement {
  const element = document.createElement(ELEMENT_NAME);
  for (const [k, v] of Object.entries(attributes)) element.setAttribute(k, v);
  document.body.append(element);
  return element;
}

async function fillGuestAndSubmit(): Promise<void> {
  await type('#firstName', 'Ayşe');
  await type('#lastName', 'Yılmaz');
  await type('#email', 'ayse@example.com');
  await type('#phone', '0532 123 45 67');
  await check('#kvkk');
  await press('Complete reservation');
}

async function reachGuestForm(): Promise<void> {
  await press('Show available rooms');
  await press('Select');
}

beforeAll(() => defineWidgetElement());
beforeEach(() => {
  client = fakeClient();
  RotaBookingWidget.clientFactory = () => client;
  widget = mount();
});
afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('isolation (ADR-0003)', () => {
  it('renders everything inside a shadow root and adds no styles or nodes to the host page', async () => {
    await flush();
    expect(widget.shadowRoot).not.toBeNull();
    expect(document.head.querySelectorAll('style, link[rel=stylesheet]')).toHaveLength(0);
    expect(document.body.querySelector('.card, form, button, input')).toBeNull(); // nothing leaked into the light DOM
    expect(widget.shadowRoot?.querySelector('style')?.textContent).toContain(':host');
    expect(maybe('.card')).not.toBeNull();
  });

  it("resets inherited styles at the boundary and uses no rem units that the host's font-size could change", () => {
    const css = widget.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/:host\s*{[^}]*all:\s*initial/);
    expect(css).not.toMatch(/\d(rem|em)\b/);
  });
});

describe('booking flow (M1, M2, M3, M4)', () => {
  it('goes search -> rooms -> details -> confirmation', async () => {
    expect(text()).toContain('Book your stay');
    await press('Show available rooms');
    expect(client.availability).toHaveBeenCalledOnce();
    expect(text()).toContain('Available rooms');
    expect(text()).toContain('Standard');
    expect(text()).toContain('Family Suite');
    expect(text()).toContain('Only 2 rooms left!'); // scarcity only when <= 3
    expect(text()).not.toContain('Only 8 rooms left!');

    await press('Select');
    expect(text()).toContain('Guest details');
    await fillGuestAndSubmit();

    expect(client.createReservation).toHaveBeenCalledOnce();
    const [body, key] = client.createReservation.mock.calls[0] as [Record<string, unknown>, string];
    expect(body).toMatchObject({
      roomTypeId: 'r1',
      adults: 2,
      guest: { firstName: 'Ayşe', email: 'ayse@example.com', phone: '0532 123 45 67' },
      consents: { kvkk: true, marketing: false },
    });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect($('[data-testid=reservation-code]').textContent).toBe('RT-ABCDEFGH');
    expect(text()).toContain('Your reservation is confirmed');
  });

  it('blocks an invalid search before calling the API', async () => {
    await type('#checkIn', '2020-01-01');
    await press('Show available rooms');
    expect(client.availability).not.toHaveBeenCalled();
    expect(text()).toContain('The date cannot be in the past.');
    expect($('#checkIn').getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps check-out after check-in when the check-in date moves', async () => {
    await type('#checkIn', '2031-05-10');
    expect($<HTMLInputElement>('#checkOut').value).toBe('2031-05-11');
  });

  it('shows an empty state when nothing is available', async () => {
    client.availability.mockResolvedValueOnce(availability([]));
    await press('Show available rooms');
    expect(text()).toContain('No rooms are available for these dates.');
    expect(maybe('.rooms')).toBeNull();
  });

  it('requires the KVKK notice, and never pre-ticks either consent', async () => {
    await reachGuestForm();
    expect($<HTMLInputElement>('#kvkk').checked).toBe(false);
    expect($<HTMLInputElement>('#marketing').checked).toBe(false);

    await type('#firstName', 'Ayşe');
    await type('#lastName', 'Yılmaz');
    await type('#email', 'ayse@example.com');
    await type('#phone', '0532 123 45 67');
    await press('Complete reservation');
    expect(client.createReservation).not.toHaveBeenCalled();
    expect(text()).toContain('You need to acknowledge the information notice');
  });

  it('shows field errors and does not submit an incomplete form', async () => {
    await reachGuestForm();
    await press('Complete reservation');
    expect(client.createReservation).not.toHaveBeenCalled();
    expect(text()).toContain('This field is required.');
    await type('#email', 'nope');
    await press('Complete reservation');
    expect(text()).toContain('Enter a valid email address.');
  });

  it('sends the marketing consent only when the guest ticks it', async () => {
    await reachGuestForm();
    await check('#marketing');
    await fillGuestAndSubmit();
    expect(client.createReservation.mock.calls[0]?.[0]).toMatchObject({ consents: { kvkk: true, marketing: true } });
  });

  it('maps a server-side field error onto its field', async () => {
    client.createReservation.mockRejectedValueOnce(new ApiError(422, 'INVALID_PHONE', 'bad phone'));
    await reachGuestForm();
    await fillGuestAndSubmit();
    expect($('#phone').getAttribute('aria-invalid')).toBe('true');
    expect(text()).toContain('Enter a valid phone number.');
    expect(text()).toContain('Guest details'); // still on the form
  });
});

describe('idempotency from the visitor\'s side (M7)', () => {
  it('retries a failed booking with the SAME key, and uses a NEW key once the details change', async () => {
    client.createReservation.mockRejectedValueOnce(new NetworkError('offline'));
    await reachGuestForm();
    await fillGuestAndSubmit();
    expect(text()).toContain('Could not reach the server');

    await press('Try again'); // same details, same intent
    const keys = client.createReservation.mock.calls.map((call) => call[1] as string);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('uses a different key when the guest edits a field between attempts', async () => {
    client.createReservation.mockRejectedValueOnce(new NetworkError('offline'));
    await reachGuestForm();
    await fillGuestAndSubmit();
    await type('#phone', '0533 999 88 77');
    await press('Complete reservation');
    const keys = client.createReservation.mock.calls.map((call) => call[1] as string);
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('sold out while booking (M6 from the visitor\'s side)', () => {
  it('returns to a refreshed room list with an explanation instead of a dead end', async () => {
    await reachGuestForm();
    client.createReservation.mockRejectedValueOnce(new ApiError(409, 'SOLD_OUT', 'gone'));
    client.availability.mockResolvedValueOnce(availability([room('r2', 'family', 'Family Suite', 1, 750_000)]));
    await fillGuestAndSubmit();

    expect(text()).toContain('Sorry, this room was just booked by someone else');
    expect(text()).toContain('Available rooms');
    expect(text()).toContain('Family Suite');
    expect(text()).not.toContain('Standard');
  });
});

describe('cancellation (M8)', () => {
  it('cancels from the confirmation screen after asking', async () => {
    await reachGuestForm();
    await fillGuestAndSubmit();
    await press('Cancel reservation');
    expect(client.cancelReservation).not.toHaveBeenCalled(); // asks first
    await press('Yes, cancel');
    expect(client.cancelReservation).toHaveBeenCalledWith('RT-ABCDEFGH', 'ayse@example.com');
    expect(text()).toContain('Reservation cancelled');
  });

  it('cancels from the search screen with a code and email', async () => {
    await press('Cancel my reservation');
    expect(buttonByText('Cancel reservation').disabled).toBe(true);
    await type('#manage-code', 'rt-abcdefgh');
    await type('#manage-email', 'ayse@example.com');
    await press('Cancel reservation');
    expect(client.cancelReservation).toHaveBeenCalledWith('rt-abcdefgh', 'ayse@example.com');
    expect(text()).toContain('Reservation cancelled');
  });

  it('explains a failed cancellation in the visitor\'s language', async () => {
    client.cancelReservation.mockRejectedValueOnce(new ApiError(404, 'RESERVATION_NOT_FOUND', 'x'));
    await press('Cancel my reservation');
    await type('#manage-code', 'RT-ZZZZZZZZ');
    await type('#manage-email', 'x@example.com');
    await press('Cancel reservation');
    expect(text()).toContain('No reservation matches this code and email.');
  });
});

describe('language (S3)', () => {
  it('switches between Turkish and English without losing the state', async () => {
    await press('Show available rooms');
    await press('TR');
    expect(text()).toContain('Müsait odalar');
    expect(text()).toContain('Standard TR');
    expect(widget.shadowRoot?.querySelector('.card')?.getAttribute('lang')).toBe('tr');
    await press('EN');
    expect(text()).toContain('Available rooms');
  });

  it('starts in the language given by the lang attribute', async () => {
    document.body.innerHTML = '';
    widget = mount({ 'hotel-key': 'pk_lagos_beach_demo', lang: 'tr' });
    await flush();
    expect(text()).toContain('Rezervasyon');
    expect(text()).toContain('Müsait odaları göster');
  });
});

describe('configuration and mounting', () => {
  it('shows a visible error instead of a broken form when the hotel key is missing', async () => {
    document.body.innerHTML = '';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    widget = mount({});
    await flush();
    expect(widget.shadowRoot?.querySelector('[role=alert]')?.textContent).toContain('Missing data-hotel-key');
    spy.mockRestore();
  });

  it('applies a valid accent colour to the widget only', async () => {
    document.body.innerHTML = '';
    widget = mount({ 'hotel-key': 'pk_lagos_beach_demo', accent: '#aa3300' });
    expect(widget.style.getPropertyValue('--rota-accent')).toBe('#aa3300');
  });

  it('mounts itself next to its <script> tag from the data-* attributes (the one-line embed)', async () => {
    document.body.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://cdn.example.com/widget.js';
    script.setAttribute('data-hotel-key', 'pk_peri_stone_demo');
    script.setAttribute('data-lang', 'en');
    script.setAttribute('data-api-base', 'https://api.example.com');
    document.body.append(script);

    mountFromScriptTag(script);
    mountFromScriptTag(script); // idempotent: a double include does not create two widgets

    const widgets = document.querySelectorAll(ELEMENT_NAME);
    expect(widgets).toHaveLength(1);
    expect(script.nextElementSibling).toBe(widgets[0]);
    expect(widgets[0]?.getAttribute('hotel-key')).toBe('pk_peri_stone_demo');
    expect(widgets[0]?.getAttribute('api-base')).toBe('https://api.example.com');
  });

  it('can be placed into a target element chosen by the hotel', () => {
    document.body.innerHTML = '<div id="booking-here"></div>';
    const script = document.createElement('script');
    script.src = 'https://cdn.example.com/widget.js';
    script.setAttribute('data-hotel-key', 'pk_peri_stone_demo');
    script.setAttribute('data-target', '#booking-here');
    document.body.append(script);
    mountFromScriptTag(script);
    expect(document.querySelector('#booking-here')?.querySelector(ELEMENT_NAME)).not.toBeNull();
  });
});
