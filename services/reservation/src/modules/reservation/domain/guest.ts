import { DomainError } from '../../../shared/errors.js';

export interface GuestInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

/** A guest whose fields are trimmed and normalized, so the same person always looks the same. */
export interface Guest {
  readonly firstName: string;
  readonly lastName: string;
  /** Lower-cased: emails are matched case-insensitively (cancellation, CRM de-duplication). */
  readonly email: string;
  /** E.164, e.g. "+905321234567". */
  readonly phone: string;
}

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const TURKEY_NATIONAL_DIGITS = 10;

function invalid(code: string, message: string, field: string): DomainError {
  return new DomainError(code, message, 'rule_violation', { field });
}

function normalizeName(value: string, field: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw invalid('INVALID_GUEST_NAME', `${field} must be 1-${MAX_NAME_LENGTH} characters.`, field);
  }
  return name;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Phone numbers are stored in E.164. Turkish formats are accepted because the first
 * customers are Turkish hotels: "0532 123 45 67", "532 123 45 67", "0090 532 ..." and
 * "+90 532 ..." all become "+905321234567". Other countries must be given with "+".
 *
 * @throws DomainError INVALID_PHONE
 */
export function normalizePhone(value: string): string {
  let digits = value.replace(/[\s().-]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (/^0\d{10}$/.test(digits)) digits = `+90${digits.slice(1)}`;
  else if (/^5\d{9}$/.test(digits)) digits = `+90${digits}`;

  const turkish = digits.startsWith('+90');
  const valid =
    E164_PATTERN.test(digits) && (!turkish || digits.length === 3 + TURKEY_NATIONAL_DIGITS);
  if (!valid) {
    throw invalid(
      'INVALID_PHONE',
      'Phone must be a valid number; use the + country code for numbers outside Turkey.',
      'phone',
    );
  }
  return digits;
}

/** @throws DomainError INVALID_GUEST_NAME | INVALID_EMAIL | INVALID_PHONE */
export function createGuest(input: GuestInput): Guest {
  const email = normalizeEmail(input.email);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw invalid('INVALID_EMAIL', 'Email address is not valid.', 'email');
  }
  return {
    firstName: normalizeName(input.firstName, 'firstName'),
    lastName: normalizeName(input.lastName, 'lastName'),
    email,
    phone: normalizePhone(input.phone),
  };
}
