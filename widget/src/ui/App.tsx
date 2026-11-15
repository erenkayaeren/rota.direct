import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, NetworkError, type ApiClient } from '../api/client.js';
import type {
  AvailabilityResponse,
  ConsentInput,
  CreateReservationBody,
  GuestInput,
  Reservation,
  RoomOffer,
  SearchInput,
} from '../api/types.js';
import type { WidgetConfig } from '../config.js';
import { addDaysIso, todayIso } from '../domain/dates.js';
import { newIdempotencyKey } from '../domain/ids.js';
import { formatMoney } from '../domain/money.js';
import { LIMITS, validateGuest, validateSearch, type GuestField, type SearchField } from '../domain/validation.js';
import { errorMessage, LANGUAGES, messagesFor, type Language, type Messages } from '../i18n/index.js';
import { Banner, Field } from './fields.js';

type Step = 'search' | 'results' | 'guest' | 'done' | 'manage';

const EMPTY_GUEST: GuestInput = { firstName: '', lastName: '', email: '', phone: '' };
const STEP_ORDER: Array<keyof Messages['steps']> = ['search', 'rooms', 'guest', 'done'];
const STEP_INDEX: Record<Step, number> = { search: 0, manage: 0, results: 1, guest: 2, done: 3 };

/** Server error codes that point at one form field. */
const FIELD_OF_CODE: Record<string, GuestField> = {
  INVALID_EMAIL: 'email',
  INVALID_PHONE: 'phone',
  KVKK_CONSENT_REQUIRED: 'kvkk',
  INVALID_GUEST_NAME: 'firstName',
};

function describeFailure(error: unknown, m: Messages): string {
  if (error instanceof NetworkError) return m.errors.network;
  if (error instanceof ApiError) return errorMessage(m, error.code);
  return m.errors.generic;
}

export function App({ config, client }: { config: WidgetConfig; client: ApiClient }) {
  const [language, setLanguage] = useState<Language>(config.language);
  const m = messagesFor(language);

  const today = useMemo(() => todayIso(), []);
  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState<SearchInput>({ checkIn: addDaysIso(today, 1), checkOut: addDaysIso(today, 3), adults: 2, children: 0 });
  const [searchErrors, setSearchErrors] = useState<Partial<Record<SearchField, string>>>({});
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [selected, setSelected] = useState<RoomOffer | null>(null);
  const [guest, setGuest] = useState<GuestInput>(EMPTY_GUEST);
  const [consents, setConsents] = useState<ConsentInput>({ kvkk: false, marketing: false });
  const [guestErrors, setGuestErrors] = useState<Partial<Record<GuestField, string>>>({});
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [cancelState, setCancelState] = useState<'idle' | 'asking' | 'cancelling' | 'cancelled'>('idle');
  const [manage, setManage] = useState({ code: '', email: '' });
  const [manageError, setManageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bannerError, setBannerError] = useState<{ message: string; retry?: () => void } | null>(null);

  // One Idempotency-Key per booking *intent*: a retry of the same request reuses it (so a
  // double click or a lost answer cannot book twice), changed details get a new one.
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [step, cancelState]);

  const money = (minor: number, currency: string): string => formatMoney(minor, currency, m.locale);
  const go = (next: Step): void => {
    setBannerError(null);
    setStep(next);
  };

  async function runSearch(event?: Event): Promise<void> {
    event?.preventDefault();
    const errors = validateSearch(search, today);
    setSearchErrors(Object.fromEntries(Object.entries(errors).map(([field, key]) => [field, m.field[key]])));
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    setBannerError(null);
    try {
      setAvailability(await client.availability(search));
      setSelected(null);
      setStep('results');
    } catch (error) {
      setBannerError({ message: describeFailure(error, m), retry: () => void runSearch() });
    } finally {
      setBusy(false);
    }
  }

  async function submitBooking(event?: Event): Promise<void> {
    event?.preventDefault();
    if (selected === null) return;
    const errors = validateGuest(guest, consents);
    setGuestErrors(Object.fromEntries(Object.entries(errors).map(([field, key]) => [field, m.field[key]])));
    if (Object.keys(errors).length > 0) return;

    const body: CreateReservationBody = { ...search, roomTypeId: selected.id, guest, consents };
    const fingerprint = JSON.stringify(body);
    if (keyRef.current?.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: newIdempotencyKey() };

    setBusy(true);
    setBannerError(null);
    try {
      const result = await client.createReservation(body, keyRef.current.key);
      setReservation(result.reservation);
      setCancelState('idle');
      setStep('done');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'SOLD_OUT') {
        // Someone took the last room: show what is still available instead of a dead end.
        try {
          setAvailability(await client.availability(search));
        } catch {
          /* the banner below is enough; the visitor can search again */
        }
        setSelected(null);
        setStep('results');
        setBannerError({ message: errorMessage(m, 'SOLD_OUT') });
      } else if (error instanceof ApiError && FIELD_OF_CODE[error.code] !== undefined) {
        setGuestErrors({ [FIELD_OF_CODE[error.code] as GuestField]: errorMessage(m, error.code) });
      } else {
        setBannerError({ message: describeFailure(error, m), retry: () => void submitBooking() });
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel(code: string, email: string, onDone: () => void, onFail: (message: string) => void): Promise<void> {
    try {
      await client.cancelReservation(code, email);
      onDone();
    } catch (error) {
      onFail(describeFailure(error, m));
    }
  }

  function startOver(): void {
    setSelected(null);
    setAvailability(null);
    setReservation(null);
    setGuest(EMPTY_GUEST);
    setConsents({ kvkk: false, marketing: false });
    setGuestErrors({});
    setCancelState('idle');
    keyRef.current = null;
    go('search');
  }

  const stay = availability?.stay;

  return (
    <div class="card" lang={language}>
      <header class="header">
        <div>
          <h2 class="title">{m.title}</h2>
          <p class="subtitle">{m.subtitle}</p>
        </div>
        <div class="lang" role="group" aria-label={m.language}>
          {LANGUAGES.map((code) => (
            <button type="button" class={`lang-btn${code === language ? ' active' : ''}`} aria-pressed={code === language} onClick={() => setLanguage(code)}>
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <ol class="steps" aria-label={m.title}>
        {STEP_ORDER.map((name, index) => (
          <li class={index === STEP_INDEX[step] ? 'current' : index < STEP_INDEX[step] ? 'past' : ''} aria-current={index === STEP_INDEX[step] ? 'step' : undefined}>
            <span class="dot">{index + 1}</span>
            {m.steps[name]}
          </li>
        ))}
      </ol>

      {bannerError ? <Banner message={bannerError.message} onRetry={bannerError.retry} retryLabel={m.retry} /> : null}

      {step === 'search' && (
        <form class="panel" onSubmit={runSearch} noValidate>
          <div class="grid">
            <Field id="checkIn" label={m.search.checkIn} error={searchErrors.checkIn}>
              {(a11y) => (
                <input {...a11y} type="date" value={search.checkIn} min={today} required
                  onInput={(e) => {
                    const checkIn = (e.target as HTMLInputElement).value;
                    // keep the range valid while the visitor picks dates
                    setSearch((s) => ({ ...s, checkIn, checkOut: checkIn && s.checkOut <= checkIn ? addDaysIso(checkIn, 1) : s.checkOut }));
                  }} />
              )}
            </Field>
            <Field id="checkOut" label={m.search.checkOut} error={searchErrors.checkOut}>
              {(a11y) => (
                <input {...a11y} type="date" value={search.checkOut} min={search.checkIn || today} required
                  onInput={(e) => setSearch((s) => ({ ...s, checkOut: (e.target as HTMLInputElement).value }))} />
              )}
            </Field>
            <Field id="adults" label={m.search.adults} error={searchErrors.adults}>
              {(a11y) => (
                <input {...a11y} type="number" inputMode="numeric" min={1} max={LIMITS.maxAdults} value={search.adults}
                  onInput={(e) => setSearch((s) => ({ ...s, adults: Number((e.target as HTMLInputElement).value) }))} />
              )}
            </Field>
            <Field id="children" label={m.search.children} error={searchErrors.children}>
              {(a11y) => (
                <input {...a11y} type="number" inputMode="numeric" min={0} max={LIMITS.maxChildren} value={search.children}
                  onInput={(e) => setSearch((s) => ({ ...s, children: Number((e.target as HTMLInputElement).value) }))} />
              )}
            </Field>
          </div>
          <h3 class="sr-only" tabIndex={-1} ref={headingRef}>{m.title}</h3>
          <button type="submit" class="primary" disabled={busy}>{busy ? m.search.searching : m.search.submit}</button>
          <button type="button" class="link center" onClick={() => go('manage')}>{m.search.manage}</button>
        </form>
      )}

      {step === 'results' && availability && stay && (
        <section class="panel" aria-live="polite">
          <h3 tabIndex={-1} ref={headingRef}>{m.results.heading}</h3>
          <p class="muted">{formatRange(stay.checkIn, stay.checkOut, m.locale)} · {m.results.summary(stay.nights, stay.adults, stay.children)}</p>
          {availability.roomTypes.length === 0 ? (
            <div class="empty">
              <p><strong>{m.results.none}</strong></p>
              <p class="muted">{m.results.noneHint}</p>
            </div>
          ) : (
            <ul class="rooms">
              {availability.roomTypes.map((room) => (
                <li class="room">
                  <div class="room-info">
                    <h4>{room.name[language]}</h4>
                    <p class="muted">{m.results.upTo(room.maxGuests)}</p>
                    {room.remaining <= 3 ? <p class="badge">{m.results.lastRooms(room.remaining)}</p> : null}
                  </div>
                  <div class="room-price">
                    <p class="price">{money(room.nightlyPrice.amountMinor, room.nightlyPrice.currency)} <span class="muted">{m.results.perNight}</span></p>
                    <p class="muted">{m.results.total}: <strong>{money(room.totalPrice.amountMinor, room.totalPrice.currency)}</strong></p>
                    <button type="button" class="primary small" onClick={() => { setSelected(room); go('guest'); }}>{m.results.select}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button type="button" class="secondary" onClick={() => go('search')}>{m.results.change}</button>
        </section>
      )}

      {step === 'guest' && selected && stay && (
        <form class="panel" onSubmit={submitBooking} noValidate>
          <h3 tabIndex={-1} ref={headingRef}>{m.guest.heading}</h3>
          <div class="summary">
            <strong>{m.guest.yourStay}</strong>
            <span>{selected.name[language]} · {formatRange(stay.checkIn, stay.checkOut, m.locale)} · {m.nights(stay.nights)}</span>
            <span>{m.done.total}: <strong>{money(selected.totalPrice.amountMinor, selected.totalPrice.currency)}</strong> <span class="muted">({m.guest.payAtHotel})</span></span>
          </div>
          <div class="grid">
            <Field id="firstName" label={m.guest.firstName} error={guestErrors.firstName}>
              {(a11y) => <input {...a11y} type="text" autocomplete="given-name" maxLength={100} value={guest.firstName} onInput={(e) => setGuest((g) => ({ ...g, firstName: (e.target as HTMLInputElement).value }))} />}
            </Field>
            <Field id="lastName" label={m.guest.lastName} error={guestErrors.lastName}>
              {(a11y) => <input {...a11y} type="text" autocomplete="family-name" maxLength={100} value={guest.lastName} onInput={(e) => setGuest((g) => ({ ...g, lastName: (e.target as HTMLInputElement).value }))} />}
            </Field>
            <Field id="email" label={m.guest.email} error={guestErrors.email}>
              {(a11y) => <input {...a11y} type="email" autocomplete="email" maxLength={200} value={guest.email} onInput={(e) => setGuest((g) => ({ ...g, email: (e.target as HTMLInputElement).value }))} />}
            </Field>
            <Field id="phone" label={m.guest.phone} hint={m.guest.phoneHint} error={guestErrors.phone}>
              {(a11y) => <input {...a11y} type="tel" autocomplete="tel" maxLength={40} value={guest.phone} onInput={(e) => setGuest((g) => ({ ...g, phone: (e.target as HTMLInputElement).value }))} />}
            </Field>
          </div>

          <div class={`check${guestErrors.kvkk ? ' has-error' : ''}`}>
            <input id="kvkk" type="checkbox" checked={consents.kvkk} aria-invalid={Boolean(guestErrors.kvkk)} aria-describedby={guestErrors.kvkk ? 'kvkk-error' : undefined}
              onChange={(e) => setConsents((c) => ({ ...c, kvkk: (e.target as HTMLInputElement).checked }))} />
            <label for="kvkk">
              {m.guest.kvkk}{' '}
              {config.kvkkUrl ? <a href={config.kvkkUrl} target="_blank" rel="noopener noreferrer">{m.guest.kvkkLink}</a> : null}
            </label>
          </div>
          {guestErrors.kvkk ? <p class="error" id="kvkk-error">{guestErrors.kvkk}</p> : null}
          <div class="check">
            {/* never pre-ticked: marketing permission must be an active choice */}
            <input id="marketing" type="checkbox" checked={consents.marketing} onChange={(e) => setConsents((c) => ({ ...c, marketing: (e.target as HTMLInputElement).checked }))} />
            <label for="marketing">{m.guest.marketing}</label>
          </div>

          <button type="submit" class="primary" disabled={busy}>{busy ? m.guest.submitting : m.guest.submit}</button>
          <button type="button" class="secondary" disabled={busy} onClick={() => go('results')}>{m.guest.back}</button>
        </form>
      )}

      {step === 'done' && (reservation || cancelState === 'cancelled') && (
        <section class="panel" aria-live="polite">
          {cancelState === 'cancelled' ? (
            <>
              <h3 tabIndex={-1} ref={headingRef}>{m.done.cancelledHeading}</h3>
              <p>{m.done.cancelledBody}</p>
              <button type="button" class="primary" onClick={startOver}>{m.done.newBooking}</button>
            </>
          ) : reservation ? (
            <>
              <h3 tabIndex={-1} ref={headingRef}>{m.done.heading}</h3>
              <p>{m.done.lead(reservation.guest.email)}</p>
              <p class="code-label">{m.done.code}</p>
              <p class="code" data-testid="reservation-code">{reservation.code}</p>
              <dl class="facts">
                <dt>{m.done.room}</dt><dd>{reservation.roomType.name[language]}</dd>
                <dt>{m.done.dates}</dt><dd>{formatRange(reservation.checkIn, reservation.checkOut, m.locale)} ({m.nights(reservation.nights)})</dd>
                <dt>{m.done.guests}</dt><dd>{m.guests(reservation.adults, reservation.children)}</dd>
                <dt>{m.done.total}</dt><dd>{money(reservation.totalPriceMinor, reservation.currency)}</dd>
              </dl>
              <p class="muted">{m.done.keepCode}</p>
              {cancelState === 'idle' && <button type="button" class="secondary" onClick={() => setCancelState('asking')}>{m.done.cancel}</button>}
              {(cancelState === 'asking' || cancelState === 'cancelling') && (
                <div class="confirm" role="group" aria-label={m.done.cancelAsk}>
                  <p>{m.done.cancelAsk}</p>
                  <button type="button" class="danger" disabled={cancelState === 'cancelling'}
                    onClick={() => {
                      setCancelState('cancelling');
                      void cancel(reservation.code, reservation.guest.email,
                        () => setCancelState('cancelled'),
                        (message) => { setCancelState('asking'); setBannerError({ message }); });
                    }}>
                    {cancelState === 'cancelling' ? m.done.cancelling : m.done.cancelYes}
                  </button>
                  <button type="button" class="secondary" disabled={cancelState === 'cancelling'} onClick={() => setCancelState('idle')}>{m.done.cancelNo}</button>
                </div>
              )}
            </>
          ) : null}
        </section>
      )}

      {step === 'manage' && (
        <form class="panel" noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setManageError(null);
            void cancel(manage.code, manage.email,
              () => { setBusy(false); setReservation(null); setCancelState('cancelled'); setStep('done'); },
              (message) => { setBusy(false); setManageError(message); });
          }}>
          <h3 tabIndex={-1} ref={headingRef}>{m.manage.heading}</h3>
          <p class="muted">{m.manage.lead}</p>
          <Field id="manage-code" label={m.manage.code}>
            {(a11y) => <input {...a11y} type="text" autocomplete="off" autocapitalize="characters" value={manage.code} onInput={(e) => setManage((s) => ({ ...s, code: (e.target as HTMLInputElement).value }))} />}
          </Field>
          <Field id="manage-email" label={m.manage.email}>
            {(a11y) => <input {...a11y} type="email" autocomplete="email" value={manage.email} onInput={(e) => setManage((s) => ({ ...s, email: (e.target as HTMLInputElement).value }))} />}
          </Field>
          {manageError ? <Banner message={manageError} /> : null}
          <button type="submit" class="danger" disabled={busy || manage.code.trim() === '' || manage.email.trim() === ''}>{m.manage.submit}</button>
          <button type="button" class="secondary" onClick={() => go('search')}>{m.manage.back}</button>
        </form>
      )}

      <footer class="footer">{m.poweredBy}</footer>
    </div>
  );
}

/** "10 Kas – 13 Kas 2026" style range in the visitor's language. */
export function formatRange(checkIn: string, checkOut: string, locale: string): string {
  const format = (iso: string, withYear: boolean): string =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
  return `${format(checkIn, false)} – ${format(checkOut, true)}`;
}
