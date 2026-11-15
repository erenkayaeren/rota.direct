/**
 * Identity key of a guest within a hotel. Only trimming and lower-casing: provider-specific
 * tricks (dots or "+tags" in Gmail) are NOT applied, because treating two different addresses as
 * one person is worse than keeping two profiles (ADR-0007).
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
