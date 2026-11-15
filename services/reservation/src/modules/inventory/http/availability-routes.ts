import type { FastifyPluginAsync } from 'fastify';
import type { CachedAvailability } from '../application/availability-cache.js';
import { parseAvailabilityQuery } from './availability-query.js';
import { toAvailabilityResponse, type AvailabilityResponse } from './availability-response.js';

export interface AvailabilityRoutesOptions {
  availability: CachedAvailability;
}

/** Registered inside the tenant scope, so `request.hotel` is always set (see tenant-context.ts). */
export const availabilityRoutes: FastifyPluginAsync<AvailabilityRoutesOptions> = async (scope, options) => {
  scope.get('/availability', async (request, reply): Promise<AvailabilityResponse> => {
    const input = parseAvailabilityQuery(request.query);
    const { result, cache } = await options.availability.execute(request.hotel, input);
    // Stock changes with every booking; browsers must never reuse an old answer. Only this
    // server caches (briefly, with invalidation: ADR-0009); X-Cache says whether it did.
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Cache', cache.toUpperCase());
    return toAvailabilityResponse(result);
  });
};
