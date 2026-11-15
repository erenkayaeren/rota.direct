import amqp from 'amqplib';
import { afterAll, describe, expect, it } from 'vitest';
import { AmqpEventPublisher, EVENTS_EXCHANGE } from '../../src/modules/reservation/infra/amqp-event-publisher.js';

// Needs a RabbitMQ (docker compose up rabbitmq); skipped when TEST_AMQP_URL is not set.
const url = process.env['TEST_AMQP_URL'];

describe.skipIf(url === undefined)('AmqpEventPublisher', () => {
  const closers: Array<() => Promise<unknown>> = [];
  afterAll(async () => {
    for (const close of closers.reverse()) await close().catch(() => undefined);
  });

  it('publishes a persistent message with the event type as routing key and the id as message id', async () => {
    const connection = await amqp.connect(url as string);
    closers.push(() => connection.close());
    const channel = await connection.createChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    const { queue } = await channel.assertQueue('', { exclusive: true });
    await channel.bindQueue(queue, EVENTS_EXCHANGE, 'reservation.*');

    const publisher = await AmqpEventPublisher.connect(url as string);
    closers.push(() => publisher.close());
    await publisher.publish({
      eventId: 'e0d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c11',
      type: 'reservation.created',
      occurredAt: '2026-10-26T12:00:00.000Z',
      hotelId: 'h-1',
      aggregateId: 'a-1',
      version: 1,
      data: { hello: 'world' },
    });

    const message = await channel.get(queue, { noAck: true });
    expect(message).not.toBe(false);
    if (message === false) return;
    expect(message.fields.routingKey).toBe('reservation.created');
    expect(message.properties.messageId).toBe('e0d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c11');
    expect(message.properties.deliveryMode).toBe(2);
    expect(JSON.parse(message.content.toString())).toMatchObject({ version: 1, data: { hello: 'world' } });
  });

  it('refuses to call an unroutable event published (no queue bound), so it stays in the outbox', async () => {
    const connection = await amqp.connect(url as string);
    closers.push(() => connection.close());
    const channel = await connection.createChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });

    const publisher = await AmqpEventPublisher.connect(url as string);
    closers.push(() => publisher.close());
    await expect(
      publisher.publish({
        eventId: 'f1d7c7a2-9d0e-4a55-8f5b-0b6a9b8f1c22',
        type: 'nobody.listens.to.this',
        occurredAt: '2026-10-26T12:00:00.000Z',
        hotelId: 'h-1',
        aggregateId: 'a-1',
        version: 1,
        data: {},
      }),
    ).rejects.toThrow(/No queue is bound/);
  });
});
