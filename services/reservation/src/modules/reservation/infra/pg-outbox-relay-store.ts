import type { Pool } from 'pg';
import { withTransaction } from '../../../platform/db/transaction.js';
import type { OutboxBatch, OutboxRecord, OutboxRelayStore } from '../application/ports.js';

/** Arbitrary application-wide constant: "I am the outbox relay". Distinct from the migrator's key. */
const RELAY_LOCK_KEY = 727_002;

interface OutboxRow {
  id: string;
  seq: string;
  hotel_id: string;
  aggregate_id: string;
  aggregate_version: number;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
}

/**
 * A transaction-scoped advisory lock makes exactly one relay active at a time, which is what
 * preserves `seq` order when several replicas run. If the holder dies, Postgres releases the
 * lock with the connection and another replica takes over.
 */
export class PgOutboxRelayStore implements OutboxRelayStore {
  constructor(private readonly pool: Pool) {}

  withBatch<T>(limit: number, work: (batch: OutboxBatch) => Promise<T>): Promise<T | null> {
    return withTransaction(this.pool, async (client) => {
      const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        RELAY_LOCK_KEY,
      ]);
      if (lock.rows[0]?.locked !== true) return null;

      const rows = await client.query<OutboxRow>(
        `SELECT id, seq::text AS seq, hotel_id, aggregate_id, aggregate_version, event_type, payload, occurred_at
         FROM outbox_events
         WHERE published_at IS NULL
         ORDER BY seq
         LIMIT $1`,
        [limit],
      );
      const records: OutboxRecord[] = rows.rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        hotelId: row.hotel_id,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        eventType: row.event_type,
        payload: row.payload,
        occurredAt: row.occurred_at,
      }));

      return work({
        records,
        markPublished: async (ids) => {
          await client.query('UPDATE outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])', [ids]);
        },
      });
    }, 1);
  }
}
