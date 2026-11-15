import amqp from 'amqplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PoisonMessageError } from '../../src/shared/errors.js';
import {
  deadQueueName,
  EVENTS_EXCHANGE,
  RetryingConsumer,
  type IncomingMessage,
} from '../../src/platform/messaging/retrying-consumer.js';

// Needs a RabbitMQ; skipped when TEST_AMQP_URL is not set.
const url = process.env['TEST_AMQP_URL'];

describe.skipIf(url === undefined)('RetryingConsumer (ADR-0008)', () => {
  let connection: Awaited<ReturnType<typeof amqp.connect>>;
  let channel: Awaited<ReturnType<typeof connection.createChannel>>;
  const consumers: RetryingConsumer[] = [];
  const queues: string[] = [];

  beforeAll(async () => {
    connection = await amqp.connect(url as string);
    channel = await connection.createChannel();
    await channel.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
  });

  afterAll(async () => {
    for (const consumer of consumers) await consumer.close();
    for (const queue of queues) {
      for (const suffix of ['', '.dead', '.retry.30ms', '.retry.60ms']) await channel.deleteQueue(`${queue}${suffix}`).catch(() => undefined);
    }
    await connection?.close().catch(() => undefined);
  });

  async function start(name: string, handler: (m: IncomingMessage) => Promise<void>, delays = [30, 60]) {
    const queue = `test.${name}.${Date.now()}`;
    queues.push(queue);
    consumers.push(
      await RetryingConsumer.start({ url: url as string, queue, bindings: [`test.${name}`], retryDelaysMs: delays, handler }),
    );
    return queue;
  }
  const publish = (key: string, body: string) =>
    channel.publish(EVENTS_EXCHANGE, key, Buffer.from(body), { persistent: true, messageId: `m-${key}`, contentType: 'application/json' });
  const until = async (condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (!(await condition())) {
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const deadCount = async (queue: string): Promise<number> => (await channel.checkQueue(deadQueueName(queue))).messageCount;

  it('delivers a message once when the handler succeeds', async () => {
    const seen: unknown[] = [];
    await start('ok', async (m) => void seen.push(m.body));
    publish('test.ok', '{"hello":"world"}');
    await until(() => seen.length === 1);
    expect(seen[0]).toEqual({ hello: 'world' });
  });

  it('retries a failing handler with delays and succeeds on a later attempt', async () => {
    const attempts: number[] = [];
    await start('flaky', async (m) => {
      attempts.push(m.attempt);
      if (m.attempt < 2) throw new Error('database is down');
    });
    publish('test.flaky', '{"n":1}');
    await until(() => attempts.length === 3);
    expect(attempts).toEqual([0, 1, 2]);
  });

  it('parks a message in the dead-letter queue after the retries are used up', async () => {
    let calls = 0;
    const queue = await start('always-fails', async () => {
      calls++;
      throw new Error('still down');
    });
    publish('test.always-fails', '{"n":1}');
    await until(async () => (await deadCount(queue)) === 1);
    expect(calls).toBe(3); // first try + 2 retries
    const dead = await channel.get(deadQueueName(queue), { noAck: true });
    expect(dead && dead.properties.headers).toMatchObject({ 'x-last-error': 'still down', 'x-original-routing-key': 'test.always-fails' });
  });

  it('sends a poison message straight to the dead-letter queue without retrying', async () => {
    let calls = 0;
    const queue = await start('poison', async () => {
      calls++;
      throw new PoisonMessageError('bad');
    });
    publish('test.poison', '{"n":1}');
    await until(async () => (await deadCount(queue)) === 1);
    expect(calls).toBe(1);
  });

  it('treats a body that is not JSON as poison', async () => {
    let calls = 0;
    const queue = await start('badjson', async () => void calls++);
    publish('test.badjson', 'this is not json');
    await until(async () => (await deadCount(queue)) === 1);
    expect(calls).toBe(0);
  });
});
