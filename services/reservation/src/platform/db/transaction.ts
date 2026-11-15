import type { Pool, PoolClient } from 'pg';

/** Postgres error codes that mean "nothing was wrong with your statement, just try again". */
const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

export function isRetryableTransactionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

/**
 * Runs `work` in one transaction (READ COMMITTED, Postgres' default) on a dedicated connection.
 * COMMIT on success, ROLLBACK if `work` throws, connection always returned to the pool.
 *
 * Two overlapping bookings can lock the same inventory rows in a different order and deadlock;
 * Postgres then aborts one of them with 40P01. Because `work` only touches the database
 * (no emails, no HTTP calls), re-running it from the start is safe, so we retry a few times.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  maxAttempts = 4,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true; // connection is in an unknown state: do not reuse it
      }
      if (attempt >= maxAttempts || !isRetryableTransactionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5 * attempt + Math.random() * 10));
    } finally {
      client.release(broken ? true : undefined);
    }
  }
}
