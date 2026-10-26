import type { FastifyPluginAsync } from 'fastify';
import type { SearchAvailability } from '../application/search-availability.js';
import { parseAvailabilityQuery } from './availability-query.js';
import { toAvailabilityResponse, type AvailabilityResponse } from './availability-response.js';

export interface AvailabilityRoutesOptions {
  searchAvailability: SearchAvailability;
}

/** Registered inside the tenant scope, so `request.hotel` is always set (see tenant-context.ts). */
export const availabilityRoutes: FastifyPluginAsync<AvailabilityRoutesOptions> = async (scope, options) => {
  scope.get('/availability', async (request, reply): Promise<AvailabilityResponse> => {
    const input = parseAvailabilityQuery(request.query);
    const result = await options.searchAvailability.execute(request.hotel, input);
    // Stock changes with every booking; browsers must never reuse an old answer.
    reply.header('Cache-Control', 'no-store');
    return toAvailabilityResponse(result);
  });
};
