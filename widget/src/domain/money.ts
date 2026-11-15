/**
 * Amounts travel as integer minor units (kurus) and are divided by 100 only here, for display.
 * Whole amounts drop the decimals ("3.200 ₺"), fractional ones keep two.
 */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  const whole = amountMinor % 100 === 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(amountMinor / 100);
}
