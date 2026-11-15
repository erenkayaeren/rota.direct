import { buildApp, type ConsumerStatus } from './app.js';
import { loadConfig } from './config.js';
import { ProjectReservationEvent } from './modules/guests/application/project-reservation-event.js';
import { PgProjectionStore } from './modules/guests/infra/pg-projection-store.js';
import { createPool } from './platform/db/pool.js';
import { RetryingConsumer } from './platform/messaging/retrying-consumer.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const consumerStatus: ConsumerStatus = { connected: false };
  const app = await buildApp({
    pool,
    panelDir: config.panelDir,
    logger: { level: config.logLevel },
    ...(config.amqpUrl === undefined ? {} : { consumerStatus }),
  });

  let stopping = false;
  let consumer: RetryingConsumer | undefined;

  // The consumer runs in this process but is independent of the HTTP side: a broker outage makes
  // events wait in the queue (and the panel keep working); it reconnects with a growing pause.
  const consumeForever = async (amqpUrl: string): Promise<void> => {
    const projector = new ProjectReservationEvent(new PgProjectionStore(pool));
    let backoffMs = 500;
    while (!stopping) {
      try {
        let lost: ((error?: Error) => void) | undefined;
        const closed = new Promise<void>((resolve) => {
          lost = () => resolve();
        });
        consumer = await RetryingConsumer.start({
          url: amqpUrl,
          queue: config.consumerQueue,
          bindings: ['reservation.*'],
          retryDelaysMs: config.consumerRetryDelaysMs,
          handler: async (message) => {
            const outcome = await projector.handle(message.body);
            app.log.info({ messageId: message.messageId, outcome }, 'event handled');
          },
          onFailure: ({ error, route, message }) =>
            app.log.warn({ err: error, route, messageId: message.messageId, attempt: message.attempt }, 'event handling failed'),
        });
        consumer.onClose((error) => lost?.(error));
        consumerStatus.connected = true;
        backoffMs = 500;
        app.log.info({ queue: config.consumerQueue }, 'consuming reservation events');
        await closed;
        consumerStatus.connected = false;
        if (!stopping) app.log.warn('broker connection lost, reconnecting');
      } catch (error) {
        consumerStatus.connected = false;
        app.log.error({ err: error, retryInMs: backoffMs }, 'cannot consume events');
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15_000);
      }
    }
  };

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopping = true;
    app.log.info({ signal }, 'shutting down');
    await consumer?.close();
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  if (config.amqpUrl !== undefined) void consumeForever(config.amqpUrl);
}

main().catch((error) => {
  console.error('Failed to start CRM service', error);
  process.exit(1);
});
