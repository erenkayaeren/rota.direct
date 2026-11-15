import { z } from 'zod';
import { localDateSchema } from '../../../platform/http/schemas.js';
import type { StaySearchInput } from '../domain/stay-search.js';

const dateParam = localDateSchema;

// Digits only: rejects "", "1.5", "-1", "1e1" instead of silently coercing them.
const countParam = z
  .string()
  .regex(/^\d{1,2}$/, 'must be a whole number')
  .transform(Number);

const querySchema = z.object({
  checkIn: dateParam,
  checkOut: dateParam,
  adults: countParam,
  children: countParam.optional(),
});

/**
 * Shape and format of the query string. Business rules (past dates, capacity, ...) are the
 * domain's job and answer 422; anything that fails here is a malformed request and answers 400.
 *
 * @throws ZodError
 */
export function parseAvailabilityQuery(rawQuery: unknown): StaySearchInput {
  const query = querySchema.parse(rawQuery);
  return {
    checkIn: query.checkIn,
    checkOut: query.checkOut,
    adults: query.adults,
    children: query.children ?? 0,
  };
}
