import amqp from 'amqplib';
import type { ConsumeMessage } from 'amqplib';
import { PoisonMessageError } from '../../shared/errors.js';

/** Topic exchange the reservation service publishes its domain events to (ADR-0006). */
export const EVENTS_EXCHANGE = 'rota.events';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;

export const retryQueueName = (queue: string, delayMs: number): string => `${queue}.retry.${delayMs}ms`;
export const deadQueueName = (queue: string): string => `${queue}.dead`;

export type FailureRoute =
  | { readonly kind: 'retry'; readonly delayMs: number; readonly attempt: number }
  | { readonly kind: 'dead' };

/**
 * Where a failed message goes. `attempt` is how many times it has already failed.
 * Poison messages skip the retries; everything else walks through `delaysMs` and then dies.
 */
export function routeFailure(error: unknown, attempt: number, delaysMs: readonly number[]): FailureRoute {
  if (error instanceof PoisonMessageError) return { kind: 'dead' };
  const delayMs = delaysMs[attempt];
  return delayMs === undefined ? { kind: 'dead' } : { kind: 'retry', delayMs, attempt: attempt + 1 };
}

export interface IncomingMessage {
  readonly messageId: string | undefined;
  /** Parsed JSON body. */
  readonly body: unknown;
  /** How many times handling this message has failed before. */
  readonly attempt: number;
}

export interface ConsumerOptions {
  url: string;
  queue: string;
  /** Routing-key patterns to bind, e.g. `reservation.*`. */
  bindings: readonly string[];
  /** Pause before retry n+1. After the last delay a failing message goes to `<queue>.dead`. */
  retryDelaysMs: readonly number[];
  prefetch?: number;
  handler: (message: IncomingMessage) => Promise<void>;
  onFailure?: (info: { error: unknown; route: FailureRoute; message: IncomingMessage }) => void;
}

/**
 * At-least-once consumer with delayed retries and a dead-letter queue, built from plain RabbitMQ
 * queues (ADR-0008). Messages are acknowledged only after the handler succeeded, or after the
 * failure was durably re-published (retry queue / dead queue, with publisher confirms). A crash
 * at any point re-delivers the message, never loses it; handlers must therefore be idempotent.
 *
 *   <queue>                 main queue, bound to the events exchange
 *   <queue>.retry.<N>ms     holds a failed message for N ms (TTL), then dead-letters it back to <queue>
 *   <queue>.dead            parking lot for messages that exhausted their retries or are poison
 */
export class RetryingConsumer {
  private constructor(
    private readonly connection: Connection,
    private readonly channel: ConfirmChannel,
    private readonly options: ConsumerOptions,
  ) {}

  static async start(options: ConsumerOptions): Promise<RetryingConsumer> {
    const connection = await amqp.connect(options.url);
    try {
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(options.queue, { durable: true });
      for (const pattern of options.bindings) await channel.bindQueue(options.queue, EVENTS_EXCHANGE, pattern);
      await channel.assertQueue(deadQueueName(options.queue), { durable: true });
      for (const delayMs of new Set(options.retryDelaysMs)) {
        await channel.assertQueue(retryQueueName(options.queue, delayMs), {
          durable: true,
          arguments: {
            'x-message-ttl': delayMs,
            // The default exchange routes by queue name: expired messages return to the main queue.
            'x-dead-letter-exchange': '',
            'x-dead-letter-routing-key': options.queue,
          },
        });
      }
      await channel.prefetch(options.prefetch ?? 10);

      const consumer = new RetryingConsumer(connection, channel, options);
      await channel.consume(options.queue, (message) => {
        if (message !== null) void consumer.process(message);
      });
      return consumer;
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  onClose(listener: (error?: Error) => void): void {
    this.connection.on('close', listener);
    this.connection.on('error', listener);
  }

  async close(): Promise<void> {
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }

  private async process(raw: ConsumeMessage): Promise<void> {
    const attempt = Number(raw.properties.headers?.['x-attempt'] ?? 0);
    let message: IncomingMessage;
    try {
      message = { messageId: raw.properties.messageId, body: JSON.parse(raw.content.toString('utf8')), attempt };
    } catch (error) {
      message = { messageId: raw.properties.messageId, body: undefined, attempt };
      await this.fail(raw, message, new PoisonMessageError('Message body is not valid JSON', { cause: error }));
      return;
    }

    try {
      await this.options.handler(message);
      this.channel.ack(raw);
    } catch (error) {
      await this.fail(raw, message, error);
    }
  }

  private async fail(raw: ConsumeMessage, message: IncomingMessage, error: unknown): Promise<void> {
    const route = routeFailure(error, message.attempt, this.options.retryDelaysMs);
    this.options.onFailure?.({ error, route, message });
    const target =
      route.kind === 'retry' ? retryQueueName(this.options.queue, route.delayMs) : deadQueueName(this.options.queue);
    try {
      await new Promise<void>((resolve, reject) => {
        this.channel.sendToQueue(
          target,
          raw.content,
          {
            persistent: true,
            contentType: raw.properties.contentType,
            messageId: raw.properties.messageId,
            type: raw.properties.type,
            timestamp: raw.properties.timestamp,
            headers: {
              ...raw.properties.headers,
              'x-attempt': route.kind === 'retry' ? route.attempt : message.attempt + 1,
              'x-last-error': String(error instanceof Error ? error.message : error).slice(0, 500),
              'x-failed-at': new Date().toISOString(),
              // After the first trip through a retry queue the routing key is the queue name, so keep the first one.
              'x-original-routing-key': raw.properties.headers?.['x-original-routing-key'] ?? raw.fields.routingKey,
            },
          },
          (confirmError) => (confirmError ? reject(confirmError instanceof Error ? confirmError : new Error(String(confirmError))) : resolve()),
        );
      });
      this.channel.ack(raw);
    } catch {
      // Could not park the message safely: give it back to the broker rather than lose it.
      this.channel.nack(raw, false, true);
    }
  }
}
