import type { Queryable } from '../../../platform/db/queryable.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { IdempotencyClaim, IdempotencyStore, StoredResponse } from '../application/ports.js';

interface KeyRow {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

/**
 * Idempotency keys are scoped per hotel: two hotels may use the same key without seeing each
 * other's answers. The claim is the INSERT itself: the primary key makes "first one wins"
 * atomic, and a second transaction inserting the same key waits for the first to finish.
 */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: Queryable) {}

  async claim(hotelId: HotelId, key: string, requestHash: string): Promise<IdempotencyClaim> {
    const inserted = await this.db.query(
      `INSERT INTO idempotency_keys (hotel_id, key, request_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (hotel_id, key) DO NOTHING`,
      [hotelId, key, requestHash],
    );
    if (inserted.rowCount === 1) return { kind: 'claimed' };

    const existing = await this.db.query<KeyRow>(
      `SELECT request_hash, response_status, response_body
       FROM idempotency_keys WHERE hotel_id = $1 AND key = $2`,
      [hotelId, key],
    );
    const row = existing.rows[0];
    if (row === undefined || row.response_status === null) {
      throw new Error('Idempotency key is present but incomplete'); // only possible if cleanup raced us
    }
    if (row.request_hash !== requestHash) return { kind: 'conflict' };
    return { kind: 'replay', response: { status: row.response_status, body: row.response_body } };
  }

  async complete(hotelId: HotelId, key: string, response: StoredResponse): Promise<void> {
    const result = await this.db.query(
      `UPDATE idempotency_keys SET response_status = $3, response_body = $4::jsonb
       WHERE hotel_id = $1 AND key = $2`,
      [hotelId, key, response.status, JSON.stringify(response.body)],
    );
    if (result.rowCount !== 1) throw new Error('Idempotency key was not claimed by this transaction');
  }
}
