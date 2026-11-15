import type { EventEnvelope, EventPublisher, OutboxRecord, OutboxRelayStore } from './ports.js';

export function toEnvelope(record: OutboxRecord): EventEnvelope {
  return {
    eventId: record.id,
    type: record.eventType,
    occurredAt: record.occurredAt.toISOString(),
    hotelId: record.hotelId,
    aggregateId: record.aggregateId,
    version: record.aggregateVersion,
    data: record.payload,
  };
}

export interface RelayResult {
  /** False when another relay instance holds the lock. */
  readonly ownedLock: boolean;
  readonly published: number;
  readonly batchWasFull: boolean;
}

/**
 * Publishes committed outbox rows to the broker, oldest first (ADR-0006).
 *
 * Delivery is at-least-once: a row is marked published only after the broker confirmed it, so
 * a crash between the two repeats the message and never loses it. Publishing stops at the first
 * failure, so a later event of a reservation is never sent before an earlier one. Consumers
 * de-duplicate by `eventId` and ignore stale `version`s.
 */
export class OutboxRelay {
  constructor(
    private readonly store: OutboxRelayStore,
    private readonly publisher: EventPublisher,
    private readonly batchSize = 100,
  ) {}

  /** @throws the publisher's error after recording the rows that did get through. */
  async runOnce(): Promise<RelayResult> {
    let failure: unknown;
    const result = await this.store.withBatch(this.batchSize, async (batch) => {
      const done: string[] = [];
      for (const record of batch.records) {
        try {
          await this.publisher.publish(toEnvelope(record));
        } catch (error) {
          failure = error;
          break;
        }
        done.push(record.id);
      }
      if (done.length > 0) await batch.markPublished(done);
      return { published: done.length, batchWasFull: batch.records.length >= this.batchSize };
    });
    if (failure !== undefined) throw failure;
    if (result === null) return { ownedLock: false, published: 0, batchWasFull: false };
    return { ownedLock: true, ...result };
  }
}
