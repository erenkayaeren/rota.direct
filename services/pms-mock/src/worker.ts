/**
 * Outbound integrations (compose service `pms-notifier`). Two independent consumers of the
 * reservation events, each with its OWN queue, retries and dead-letter queue (ADR-0008), so a
 * broken PMS never delays confirmation mails and vice versa:
 *   pms.reservation-events   -> tell the PMS about created / cancelled reservations
 *   mail.reservation-events  -> write the confirmation / cancellation mail to the log
 * `node dist/cli/replay-dead.js` puts parked messages back once the cause is fixed.
 */
import { createServer } from 'node:http';
import { loadWorkerConfig } from './config.js';
import { LogMailSender, NotifyGuest } from './mail/notify-guest.js';
import { HttpPmsClient } from './notifier/pms-client.js';
import { NotifyPms } from './notifier/notify-pms.js';
import { RetryingConsumer, type IncomingMessage } from './platform/messaging/retrying-consumer.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const log = (message: string, extra: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ time: new Date().toISOString(), service: 'pms-notifier', message, ...extra }));

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const pms = new NotifyPms(new HttpPmsClient(config.pmsBaseUrl, config.apiKey, config.timeoutMs));
  const mail = new NotifyGuest(new LogMailSender());

  const connected = new Map<string, boolean>();
  let stopping = false;
  const consumers = new Set<RetryingConsumer>();

  const health = createServer((request, response) => {
    const ok = request.url === '/health/live' || (connected.size > 0 && [...connected.values()].every(Boolean));
    response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: ok ? 'ok' : 'unavailable', consumers: Object.fromEntries(connected) }));
  });
  health.listen(config.healthPort, '0.0.0.0');

  /** Keeps one consumer alive: reconnects with a growing pause after any broker failure. */
  async function supervise(name: string, queue: string, handle: (raw: unknown) => Promise<string>): Promise<void> {
    connected.set(name, false);
    let backoffMs = 500;
    while (!stopping) {
      try {
        let lost = (): void => undefined;
        const closed = new Promise<void>((resolve) => {
          lost = resolve;
        });
        const consumer = await RetryingConsumer.start({
          url: config.amqpUrl,
          queue,
          bindings: ['reservation.*'],
          retryDelaysMs: config.retryDelaysMs,
          prefetch: 5,
          handler: async (message: IncomingMessage) => {
            const outcome = await handle(message.body);
            log('event handled', { consumer: name, messageId: message.messageId, outcome, attempt: message.attempt });
          },
          onFailure: ({ error, route, message }) =>
            log(route.kind === 'retry' ? 'handling failed, will retry' : 'giving up, message dead-lettered', {
              consumer: name,
              messageId: message.messageId,
              attempt: message.attempt,
              route,
              error: String(error),
            }),
        });
        consumers.add(consumer);
        consumer.onClose(() => lost());
        connected.set(name, true);
        backoffMs = 500;
        log('consuming reservation events', { consumer: name, queue });
        await closed;
        consumers.delete(consumer);
        connected.set(name, false);
      } catch (error) {
        connected.set(name, false);
        log('cannot consume events', { consumer: name, error: String(error), retryInMs: backoffMs });
        await sleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15_000);
      }
    }
  }

  const stop = (signal: string): void => {
    log('shutting down', { signal });
    stopping = true;
    void Promise.all([...consumers].map((c) => c.close())).then(() => process.exit(0));
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));

  await Promise.all([
    supervise('pms', config.queue, (raw) => pms.handle(raw)),
    supervise('mail', config.mailQueue, (raw) => mail.handle(raw)),
  ]);
}

main().catch((error) => {
  console.error('Failed to start the notifier', error);
  process.exit(1);
});
