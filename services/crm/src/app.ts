import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { Authenticate } from './modules/access/application/authenticate.js';
import { installStaffAuth } from './modules/access/http/staff-auth.js';
import { PgStaffDirectory } from './modules/access/infra/pg-staff-directory.js';
import { AddGuestNote } from './modules/guests/application/add-guest-note.js';
import { GetGuestProfile } from './modules/guests/application/get-guest-profile.js';
import { ListGuests } from './modules/guests/application/list-guests.js';
import { SetGuestTags } from './modules/guests/application/set-guest-tags.js';
import { guestRoutes } from './modules/guests/http/guest-routes.js';
import { PgGuestRepository } from './modules/guests/infra/pg-guest-repository.js';
import { errorHandler, notFoundHandler } from './platform/http/error-handler.js';

export interface ConsumerStatus {
  connected: boolean;
}

export interface AppDependencies {
  pool: Pool;
  /** Directory with the built staff panel (index.html + assets). Omit to serve the API only. */
  panelDir?: string;
  consumerStatus?: ConsumerStatus;
  logger?: boolean | { level: string };
}

/** Composition root of the CRM's HTTP side. The event consumer is wired in `main.ts`. */
export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.logger ?? false, requestIdHeader: 'x-request-id' });
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (request, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { status: 'ok', consumer: deps.consumerStatus === undefined ? 'disabled' : deps.consumerStatus.connected ? 'connected' : 'reconnecting' };
    } catch (error) {
      request.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'unavailable' });
    }
  });

  // For orchestration only (compose `depends_on`): "my event queue exists and is being consumed".
  // Deliberately separate from /health/ready, so a broker outage never takes the panel offline.
  app.get('/health/consumer', async (_request, reply) => {
    const ok = deps.consumerStatus === undefined || deps.consumerStatus.connected;
    return reply.code(ok ? 200 : 503).send({ consumer: ok ? 'connected' : 'reconnecting' });
  });

  const guests = new PgGuestRepository(deps.pool);
  const authenticate = new Authenticate(new PgStaffDirectory(deps.pool));

  await app.register(
    async (api: FastifyInstance) => {
      installStaffAuth(api, { authenticate });
      await api.register(guestRoutes, {
        listGuests: new ListGuests(guests),
        getGuestProfile: new GetGuestProfile(guests),
        addGuestNote: new AddGuestNote(guests),
        setGuestTags: new SetGuestTags(guests),
      });
    },
    { prefix: '/api/v1' },
  );

  if (deps.panelDir !== undefined && existsSync(deps.panelDir)) {
    // The panel is plain static files; the strict CSP means even a stored-XSS bug in guest data
    // could not load or run foreign script.
    app.addHook('onSend', async (request, reply) => {
      if (!request.url.startsWith('/api/')) {
        reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Referrer-Policy', 'no-referrer');
      }
    });
    await app.register(fastifyStatic, { root: deps.panelDir, index: 'index.html' });
  }

  return app;
}
