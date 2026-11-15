/**
 * Operator tool: moves every message from `<queue>.dead` back to `<queue>` with a fresh retry
 * budget. Run it after the cause of the failures (PMS outage, wrong key) is fixed.
 *   node dist/cli/replay-dead.js          (uses AMQP_URL and CONSUMER_QUEUE)
 */
import amqp from 'amqplib';
import { loadWorkerConfig } from '../config.js';
import { deadQueueName } from '../platform/messaging/retrying-consumer.js';

async function run(): Promise<void> {
  const config = loadWorkerConfig();
  const connection = await amqp.connect(config.amqpUrl);
  const channel = await connection.createConfirmChannel();
  const dead = deadQueueName(config.queue);
  let moved = 0;
  for (;;) {
    const message = await channel.get(dead, { noAck: false });
    if (message === false) break;
    const { headers = {} } = message.properties;
    const fresh = { ...headers, 'x-attempt': 0 };
    await new Promise<void>((resolve, reject) =>
      channel.sendToQueue(config.queue, message.content, { ...message.properties, headers: fresh, persistent: true }, (error) =>
        error ? reject(error instanceof Error ? error : new Error(String(error))) : resolve(),
      ),
    );
    channel.ack(message); // only after the confirmed re-publish: a crash duplicates, never loses
    moved++;
  }
  console.log(`[replay-dead] moved ${moved} message(s) from ${dead} to ${config.queue}`);
  await channel.close();
  await connection.close();
}

run().catch((error) => {
  console.error('[replay-dead] failed', error);
  process.exit(1);
});
