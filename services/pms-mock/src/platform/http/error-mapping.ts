import { ZodError } from 'zod';
import { DomainError, type DomainErrorKind } from '../../shared/errors.js';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface HttpError {
  status: number;
  body: ErrorBody;
  /** True for bugs and outages worth logging as errors; false for expected client mistakes. */
  unexpected: boolean;
}

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  rule_violation: 422,
  not_found: 404,
  forbidden: 403,
  conflict: 409,
  unauthenticated: 401,
};

function clientErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

/**
 * The single place where errors become HTTP responses. All errors share one JSON shape,
 * `{ "error": { "code", "message", "details"? } }`, and `code` is stable so clients (the
 * widget's Turkish/English copy) can switch on it instead of parsing messages.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof DomainError) {
    return {
      status: STATUS_BY_KIND[error.kind],
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
      unexpected: false,
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_REQUEST',
          message: 'The request is malformed.',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      unexpected: false,
    };
  }

  // Framework-level client errors (invalid JSON body, unsupported media type, ...).
  const status = clientErrorStatus(error);
  if (status !== null) {
    const message = error instanceof Error ? error.message : 'Bad request.';
    return { status, body: { error: { code: 'CLIENT_ERROR', message } }, unexpected: false };
  }

  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } },
    unexpected: true,
  };
}
