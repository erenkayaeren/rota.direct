/** Calendar dates are plain `YYYY-MM-DD` strings; no time zone ever enters the picture. */

export function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The visitor's own "today". The hotel's clock on the server remains the authority. */
export function todayIso(now: Date = new Date()): string {
  return toIsoDate(now);
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(value: string): [number, number, number] | null {
  const match = ISO_DATE.exec(value);
  if (match === null) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  const valid = check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
  return valid ? [year, month, day] : null;
}

export function isValidIsoDate(value: string): boolean {
  return parts(value) !== null;
}

export function addDaysIso(value: string, days: number): string {
  const p = parts(value);
  if (p === null) throw new RangeError(`Not a date: ${value}`);
  const date = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return date.toISOString().slice(0, 10);
}

/** Whole nights between two valid dates (negative if reversed). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parts(checkIn);
  const b = parts(checkOut);
  if (a === null || b === null) return Number.NaN;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000);
}
