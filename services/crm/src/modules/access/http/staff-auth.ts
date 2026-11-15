import type { FastifyInstance } from 'fastify';
import type { Authenticate, StaffContext } from '../application/authenticate.js';

declare module 'fastify' {
  interface FastifyRequest {
    staff: StaffContext;
  }
}

/** Every route registered in `scope` requires a valid staff token; `request.staff` is then always set. */
export function installStaffAuth(scope: FastifyInstance, deps: { authenticate: Authenticate }): void {
  scope.decorateRequest('staff', null as never);
  scope.addHook('onRequest', async (request, reply) => {
    try {
      request.staff = await deps.authenticate.execute(request.headers.authorization);
    } catch (error) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw error;
    }
    // Personal data: never cached by browsers or proxies.
    reply.header('Cache-Control', 'no-store');
  });
}
