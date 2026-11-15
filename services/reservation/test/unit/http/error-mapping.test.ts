import { describe, expect, it } from 'vitest';
import { parseAvailabilityQuery } from '../../../src/modules/inventory/http/availability-query.js';
import { toHttpError } from '../../../src/platform/http/error-mapping.js';
import { DomainError } from '../../../src/shared/errors.js';

describe('toHttpError', () => {
  it('maps domain error kinds to status codes and keeps the stable code', () => {
    const rule = toHttpError(new DomainError('STAY_TOO_LONG', 'Too long.', 'rule_violation', { maxNights: 30 }));
    expect(rule.status).toBe(422);
    expect(rule.body).toEqual({ error: { code: 'STAY_TOO_LONG', message: 'Too long.', details: { maxNights: 30 } } });
    expect(rule.unexpected).toBe(false);

    expect(toHttpError(new DomainError('HOTEL_NOT_FOUND', 'x', 'not_found')).status).toBe(404);
    expect(toHttpError(new DomainError('ORIGIN_NOT_ALLOWED', 'x', 'forbidden')).status).toBe(403);
    expect(toHttpError(new DomainError('SOLD_OUT', 'x', 'conflict')).status).toBe(409);
  });

  it('omits details when a domain error has none', () => {
    const mapped = toHttpError(new DomainError('INVALID_DATE_RANGE', 'x'));
    expect(mapped.body.error.details).toBeUndefined();
  });

  it('turns a malformed query into 400 INVALID_REQUEST naming the offending parameters', () => {
    let thrown: unknown;
    try {
      parseAvailabilityQuery({ checkIn: '2026-02-30', adults: '2' });
    } catch (error) {
      thrown = error;
    }
    const mapped = toHttpError(thrown);
    expect(mapped.status).toBe(400);
    expect(mapped.body.error.code).toBe('INVALID_REQUEST');
    const paths = (mapped.body.error.details as Array<{ path: string }>).map((issue) => issue.path);
    expect(paths).toContain('checkIn');
    expect(paths).toContain('checkOut');
  });

  it('passes framework client errors (e.g. 415) through as CLIENT_ERROR', () => {
    const error = Object.assign(new Error('Unsupported Media Type'), { statusCode: 415 });
    const mapped = toHttpError(error);
    expect(mapped.status).toBe(415);
    expect(mapped.body.error.code).toBe('CLIENT_ERROR');
  });

  it('hides the details of unexpected errors from the client and flags them for logging', () => {
    const mapped = toHttpError(new Error('connection to 10.0.0.5:5432 refused'));
    expect(mapped.status).toBe(500);
    expect(mapped.body.error.code).toBe('INTERNAL_ERROR');
    expect(mapped.body.error.message).toBe('Something went wrong.');
    expect(mapped.unexpected).toBe(true);
  });
});
