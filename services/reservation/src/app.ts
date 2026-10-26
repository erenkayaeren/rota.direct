import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { SearchAvailability } from './modules/inventory/application/search-availability.js';
import { availabilityRoutes } from './modules/inventory/http/availability-routes.js';
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
  const searchAvailability = new SearchAvailability(
    new PgInventoryReader(deps.pool),
    deps.clock ?? systemClock,
  );

  // Public widget API. Everything under this prefix is bound to one hotel (see tenant-context.ts).
  await app.register(
    async (tenantScope: FastifyInstance) => {
      installTenantContext(tenantScope, { resolveHotel });
      await tenantScope.register(availabilityRoutes, { searchAvailability });
    },
    { prefix: '/v1/public/:hotelKey' },
  );

  return app;
}
