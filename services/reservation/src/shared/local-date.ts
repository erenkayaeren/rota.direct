/**
 * Calendar dates without a time or zone ("2026-11-01").
 *
 * A hotel night is a calendar date in the hotel's own zone, so stay dates are carried as
 * plain strings end to end (HTTP -> domain -> Postgres DATE) and never as JS `Date`
 * objects, which would silently shift by the server's UTC offset. All arithmetic below
 * runs on UTC midnights, which have no DST, so adding days is always exact.
 */
declare const localDateBrand: unique symbol;
export type LocalDate = string & { readonly [localDateBrand]: 'LocalDate' };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Strict `YYYY-MM-DD` parser that also rejects impossible dates such as 2026-02-30. */
export function parseLocalDate(value: string): LocalDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return value as LocalDate;
}

/** Like {@link parseLocalDate} but throws; for literals in code and tests. */
export function localDate(value: string): LocalDate {
  const parsed = parseLocalDate(value);
  if (parsed === null) throw new RangeError(`Invalid local date: ${value}`);
  return parsed;
}

function toUtcMs(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date(toUtcMs(date) + days * MS_PER_DAY).toISOString().slice(0, 10) as LocalDate;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** Every night of a stay: `checkIn` inclusive, `checkOut` exclusive (the guest leaves that morning). */
export function eachNight(checkIn: LocalDate, checkOut: LocalDate): LocalDate[] {
  const nights: LocalDate[] = [];
  for (let date = checkIn; date < checkOut; date = addDays(date, 1)) nights.push(date);
  return nights;
}

/** The calendar date it currently is in the given IANA time zone. */
export function todayInZone(now: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return localDate(`${get('year')}-${get('month')}-${get('day')}`);
}

/** Throws when `timeZone` is not a valid IANA zone name. */
export function assertValidTimeZone(timeZone: string): void {
  new Intl.DateTimeFormat('en-US', { timeZone });
}
