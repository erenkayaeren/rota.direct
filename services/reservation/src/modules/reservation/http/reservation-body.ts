import { z } from 'zod';
import { localDateSchema } from '../../../platform/http/schemas.js';
import type { CreateReservationInput } from '../application/create-reservation.js';

// Shape only (types, presence, sane lengths). Content rules - is the email valid, is the room
// free, is KVKK ticked - live in the domain and answer 422. `.strict()` rejects unknown
// fields, so a typo like "adluts" is an error instead of silently using a default.
const createBodySchema = z
  .object({
    roomTypeId: z.string().uuid(),
    checkIn: localDateSchema,
    checkOut: localDateSchema,
    adults: z.number().int(),
    children: z.number().int().default(0),
    guest: z
      .object({
        firstName: z.string().max(200),
        lastName: z.string().max(200),
        email: z.string().max(400),
        phone: z.string().max(60),
      })
      .strict(),
    consents: z
      .object({
        kvkk: z.boolean(),
        marketing: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();

const cancelBodySchema = z.object({ email: z.string().max(400) }).strict();

// 16-128 URL-safe characters: fits UUIDs (36) and other client-generated random tokens.
const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{16,128}$/, 'must be 16-128 characters: letters, digits, "_", ".", ":" or "-"');

/** @throws ZodError */
export function parseCreateBody(raw: unknown): CreateReservationInput {
  return createBodySchema.parse(raw);
}

/** @throws ZodError */
export function parseCancelBody(raw: unknown): { email: string } {
  return cancelBodySchema.parse(raw);
}

/** @throws ZodError */
export function parseIdempotencyKey(headers: Record<string, unknown>): string {
  return z.object({ 'idempotency-key': idempotencyKeySchema }).parse(headers)['idempotency-key'];
}
