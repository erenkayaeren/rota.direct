/**
 * Errors raised by domain and application code. They carry a stable machine-readable
 * `code` (the widget maps codes to Turkish/English copy) and a `kind`; the HTTP layer
 * decides which status code a kind becomes. Domain code never mentions HTTP.
 */
export type DomainErrorKind = 'rule_violation' | 'not_found' | 'forbidden';

export class DomainError extends Error {
  readonly code: string;
  readonly kind: DomainErrorKind;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    kind: DomainErrorKind = 'rule_violation',
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.kind = kind;
    this.details = details;
  }
}
