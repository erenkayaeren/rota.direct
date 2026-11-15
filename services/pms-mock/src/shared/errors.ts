/**
 * Errors raised by domain and application code. They carry a stable machine-readable
 * `code` (the widget maps codes to Turkish/English copy) and a `kind`; the HTTP layer
 * decides which status code a kind becomes. Domain code never mentions HTTP.
 */
export type DomainErrorKind = 'rule_violation' | 'not_found' | 'forbidden' | 'conflict' | 'unauthenticated';

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

/**
 * A message that can never succeed, however often it is retried (malformed JSON, a payload that
 * breaks the event contract). The consumer sends it straight to the dead-letter queue instead of
 * wasting retries on it.
 */
export class PoisonMessageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PoisonMessageError';
  }
}
