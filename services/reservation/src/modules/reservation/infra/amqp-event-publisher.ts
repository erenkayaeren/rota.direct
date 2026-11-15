import amqp from 'amqplib';
import type { EventEnvelope, EventPublisher } from '../application/ports.js';

/** Topic exchange all domain events are published to. Consumers bind their own queues to it. */
export const EVENTS_EXCHANGE = 'rota.events';

type Connection = Awaited<ReturnType<typeof amqp.connect>>;
type ConfirmChannel = Awaited<ReturnType<Connection['createConfirmChannel']>>;

/**
 * Publishes to RabbitMQ with publisher confirms: `publish` resolves only after the broker has
 * persisted the message, which is what makes "mark as published in the outbox" safe.
 * The routing key is the event type (`reservation.created`); `messageId` is the event id.
 * Publishing is `mandatory`: a message that reaches no queue is an error, not a silent drop.
 */
export class AmqpEventPublisher implements EventPublisher {
  /** Message ids the broker handed back because no queue was bound to the routing key. */
  private readonly returned = new Set<string>();

  private constructor(
    private readonly connection: Connection,
    private readonly channel: ConfirmChannel,
  ) {
    // With `mandatory`, an unroutable message is returned (basic.return) BEFORE it is confirmed.
    channel.on('return', (message) => {
      const id = message.properties.messageId;
      if (typeof id === 'string') this.returned.add(id);
    });
  }

  static async connect(url: string): Promise<AmqpEventPublisher> {
    const connection = await amqp.connect(url);
    try {
      const channel = await connection.createConfirmChannel();
      await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
      return new AmqpEventPublisher(connection, channel);
    } catch (error) {
      await connection.close().catch(() => undefined);
      throw error;
    }
  }

  /** Resolves with a promise that settles when the connection drops, so the caller can restart. */
  onClose(listener: (error?: Error) => void): void {
    this.connection.on('close', listener);
    this.connection.on('error', listener);
  }

  async publish(event: EventEnvelope): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.channel.publish(
        EVENTS_EXCHANGE,
        event.type,
        Buffer.from(JSON.stringify(event)),
        {
          // No queue bound yet (e.g. first start, before any consumer declared its queue)? Do not
          // pretend it was delivered: fail, so the row stays in the outbox until someone listens.
          mandatory: true,
          persistent: true,
          contentType: 'application/json',
          messageId: event.eventId,
          type: event.type,
          timestamp: Math.floor(new Date(event.occurredAt).getTime() / 1000),
          headers: { hotelId: event.hotelId, version: event.version },
        },
        (error) => {
          if (error) return reject(error instanceof Error ? error : new Error(String(error)));
          if (this.returned.delete(event.eventId)) {
            return reject(new Error(`No queue is bound for ${event.type}: event ${event.eventId} was not delivered`));
          }
          resolve();
        },
      );
    });
  }

  async close(): Promise<void> {
    await this.channel.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}
