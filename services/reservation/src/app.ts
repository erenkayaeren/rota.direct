import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { SearchAvailability } from './modules/inventory/application/search-availability.js';
import { availabilityRoutes } from './modules/inventory/http/availability-routes.js';
import { CancelReservation } from './modules/reservation/application/cancel-reservation.js';
import { CreateReservation } from './modules/reservation/application/create-reservation.js';
import { reservationRoutes } from './modules/reservation/http/reservation-routes.js';
import { PgUnitOfWork } from './modules/reservation/infra/pg-unit-of-work.js';
import { PgInventoryReader } from './modules/inventory/infra/pg-inventory-reader.js';
import { ResolveHotel } from './modules/tenancy/application/resolve-hotel.js';
import { PgHotelRepository } from './modules/tenancy/infra/pg-hotel-repository.js';
import { installTenantContext } from './modules/tenancy/http/tenant-context.js';
import { errorHandler, notFoundHandler } from './platform/http/error-handler.js';
import { systemClock, type Clock } from './shared/clock.js';

export interface AppDependencies {
  pool: Pool;
  clock?: Clock;
  logger?: boolean | { level: string };
}

/**
 * Composition root: the only place that knows which adapter implements which port.
 * Tests call this with their own pool and a fixed clock; `main.ts` calls it with the real ones.
 * The caller owns the pool's lifecycle.
 */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, requestIdHeader: 'x-request-id' });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // Friendly answers for someone who opens the API in a browser.
  app.get('/', async () => ({ service: 'rota-reservation', docs: 'docs/api/openapi.yaml', health: '/health/ready' }));
  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());

  // Operational endpoints: not tenant-bound.
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (request, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { status: 'ok' };
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  const resolveHotel = new ResolveHotel(new PgHotelRepository(deps.pool));
  const clock = deps.clock ?? systemClock;
  const inventoryReader = new PgInventoryReader(deps.pool);
  const unitOfWork = new PgUnitOfWork(deps.pool);
  const searchAvailability = new SearchAvailability(inventoryReader, clock);
  const createReservation = new CreateReservation(inventoryReader, unitOfWork, clock, randomBytes);
  const cancelReservation = new CancelReservation(unitOfWork, clock);

  // Public widget API. Everything under this prefix is bound to one hotel (see tenant-context.ts).
  await app.register(
    async (tenantScope: FastifyInstance) => {
      installTenantContext(tenantScope, { resolveHotel });
      await tenantScope.register(availabilityRoutes, { searchAvailability });
      await tenantScope.register(reservationRoutes, { createReservation, cancelReservation });
    },
    { prefix: '/v1/public/:hotelKey' },
  );

  return app;
}
