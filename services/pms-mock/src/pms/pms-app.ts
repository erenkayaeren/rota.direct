import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { errorHandler, notFoundHandler } from '../platform/http/error-handler.js';

export type FailureMode = { mode: 'ok' } | { mode: 'down' } | { mode: 'flaky'; rate: number };

const reservationSchema = z
  .object({
    hotelKey: z.string().min(1),
    status: z.enum(['CONFIRMED', 'CANCELLED']),
    version: z.number().int().positive(),
    guest: z.object({ firstName: z.string(), lastName: z.string(), email: z.string(), phone: z.string() }).strict(),
    stay: z
      .object({
        checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        adults: z.number().int(),
        children: z.number().int(),
        roomTypeCode: z.string(),
      })
      .strict(),
    totalPriceMinor: z.number().int(),
    currency: z.string().length(3),
  })
  .strict();

export type PmsReservation = z.infer<typeof reservationSchema>;

interface StoredReservation extends PmsReservation {
  readonly code: string;
  readonly receivedAt: string;
}

export interface PmsOptions {
  apiKey: string;
  failure?: FailureMode;
  /** Injected for tests; decides whether a "flaky" request fails. */
  random?: () => number;
  logger?: boolean | { level: string };
}

/**
 * A stand-in for a hotel's property-management system. It is deliberately unreliable on demand
 * (`down` = every call 503, `flaky` = a share of calls 503) so the retry and dead-letter handling
 * of the notifier can be seen working. State lives in memory: restarting it forgets everything.
 *
 * Like a decent real API it is idempotent: the same Idempotency-Key is answered again without
 * effect, and an older `version` of a reservation never overwrites a newer one.
 */
export async function buildPmsApp(options: PmsOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  let failure: FailureMode = options.failure ?? { mode: 'ok' };
  const random = options.random ?? Math.random;
  const reservations = new Map<string, StoredReservation>();
  const seenKeys = new Set<string>();
  const stats = { received: 0, accepted: 0, failedOnPurpose: 0, duplicates: 0, stale: 0, unauthorized: 0 };

  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async () => ({ status: 'ok' }));

  app.put<{ Params: { code: string } }>('/api/v1/reservations/:code', async (request, reply) => {
    stats.received++;
    if (request.headers['x-api-key'] !== options.apiKey) {
      stats.unauthorized++;
      return reply.code(401).send({ error: { code: 'INVALID_API_KEY', message: 'Missing or wrong X-Api-Key.' } });
    }
    if (failure.mode === 'down' || (failure.mode === 'flaky' && random() < failure.rate)) {
      stats.failedOnPurpose++;
      return reply.code(503).send({ error: { code: 'PMS_UNAVAILABLE', message: 'The PMS is temporarily unavailable.' } });
    }

    const body = reservationSchema.parse(request.body);
    const key = request.headers['idempotency-key'];
    if (typeof key === 'string' && seenKeys.has(key)) {
      stats.duplicates++;
      return { result: 'duplicate' };
    }
    if (typeof key === 'string') seenKeys.add(key);

    const stored = reservations.get(request.params.code);
    if (stored !== undefined && stored.version >= body.version) {
      stats.stale++;
      return { result: 'stale' };
    }
    reservations.set(request.params.code, { ...body, code: request.params.code, receivedAt: new Date().toISOString() });
    stats.accepted++;
    return reply.code(stored === undefined ? 201 : 200).send({ result: stored === undefined ? 'created' : 'updated' });
  });

  // Inspection endpoints for the demo and the tests.
  app.get('/api/v1/reservations', async () => ({ items: [...reservations.values()] }));
  app.get<{ Params: { code: string } }>('/api/v1/reservations/:code', async (request, reply) => {
    const stored = reservations.get(request.params.code);
    return stored === undefined ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unknown reservation.' } }) : stored;
  });

  app.get('/admin/stats', async () => ({ ...stats, stored: reservations.size, failure }));
  app.post('/admin/failure-mode', async (request) => {
    const body = z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('ok') }),
        z.object({ mode: z.literal('down') }),
        z.object({ mode: z.literal('flaky'), rate: z.number().min(0).max(1).default(0.5) }),
      ])
      .parse(request.body);
    failure = body;
    return { failure };
  });

  return app;
}
