import type { FastifyInstance } from 'fastify';
import type { ResolveHotel } from '../application/resolve-hotel.js';
import { originNotAllowed, type Hotel } from '../domain/hotel.js';
import { decideCors } from './cors-policy.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** The tenant this request belongs to. Set by the tenant hook on every public route. */
    hotel: Hotel;
  }
}

/**
 * Makes every route registered in `scope` tenant-bound (M9): the `:hotelKey` path parameter
 * is resolved to a hotel before any handler runs, the hotel's own CORS policy is applied, and
 * handlers receive the tenant as `request.hotel`. A route inside this scope cannot execute
 * without a resolved tenant, so "forgot to scope the query" cannot start at the HTTP edge.
 *
 * The key is a path parameter (not a header) on purpose: browsers send CORS preflights without
 * custom header values, so only the URL tells the server which hotel's allow-list to apply.
 */
export function installTenantContext(scope: FastifyInstance, deps: { resolveHotel: ResolveHotel }): void {
  scope.decorateRequest('hotel', null);

  scope.addHook('onRequest', async (request, reply) => {
    const { hotelKey } = request.params as { hotelKey: string };
    const hotel = await deps.resolveHotel.execute(hotelKey);
    request.hotel = hotel;

    const decision = decideCors(hotel, request.headers.origin, request.method === 'OPTIONS');
    for (const [name, value] of Object.entries(decision.headers)) reply.header(name, value);
    if (decision.action === 'reject') throw originNotAllowed();
  });

  // CORS preflight for any path under the tenant prefix; the hook above already answered
  // allow/deny, so reaching the handler means the origin is allowed.
  scope.options('/*', async (_request, reply) => reply.code(204).send());
}
