/**
 * Outbox relay process (compose service `reservation-relay`): moves committed outbox rows to
 * RabbitMQ, oldest first, at-least-once (ADR-0006). Polls the table; when a batch was full it
 * immediately polls again, otherwise it sleeps. Any broker failure drops the connection and the
 * loop reconnects with a growing pause, so a broker outage delays events but never loses them.
 */
import { createServer } from 'node:http';
import { loadRelayConfig } from '../config.js';
import { OutboxRelay } from '../modules/reservation/application/outbox-relay.js';
import { AmqpEventPublisher } from '../modules/reservation/infra/amqp-event-publisher.js';
import { PgOutboxRelayStore } from '../modules/reservation/infra/pg-outbox-relay-store.js';
import { createPool } from '../platform/db/pool.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string, extra: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'reservation-relay', message, ...extra }));

async function main(): Promise<void> {
  const config = loadRelayConfig();
  const pool = createPool(config.databaseUrl, 3);
  const store = new PgOutboxRelayStore(pool);

  let stopping = false;
  let lastSuccessAt = Date.now();
  let totalPublished = 0;

  // Ready = the loop made progress (or found nothing to do) recently.
  const health = createServer((request, response) => {
    const ready = Date.now() - lastSuccessAt < 30_000;
    const live = request.url === '/health/live';
    response.writeHead(live || ready ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: live || ready ? 'ok' : 'unavailable', published: totalPublished }));
  });
  health.listen(config.healthPort, '0.0.0.0');

  const stop = (signal: string): void => {
    log('shutting down', { signal });
    stopping = true;
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));

  let backoffMs = 500;
  while (!stopping) {
    let publisher: AmqpEventPublisher | undefined;
    try {
      publisher = await AmqpEventPublisher.connect(config.amqpUrl);
      let connectionLost: Error | undefined;
      publisher.onClose((error) => {
        connectionLost = error ?? new Error('connection closed');
      });
      log('connected to broker');
      backoffMs = 500;

      const relay = new OutboxRelay(store, publisher, config.batchSize);
      while (!stopping && connectionLost === undefined) {
        const result = await relay.runOnce();
        lastSuccessAt = Date.now();
        totalPublished += result.published;
        if (result.published > 0) log('published events', { count: result.published });
        if (!(result.ownedLock && result.batchWasFull)) await sleep(config.pollIntervalMs);
      }
      if (connectionLost !== undefined) throw connectionLost;
    } catch (error) {
      log('relay error, will reconnect', { error: String(error), retryInMs: backoffMs });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 15_000);
    } finally {
      await publisher?.close();
    }
  }

  health.close();
  await pool.end();
}

main().catch((error) => {
  console.error('Failed to start outbox relay', error);
  process.exit(1);
});
