import type { Queryable } from '../../../platform/db/queryable.js';
import { NIL_UUID } from '../../../shared/uuid.js';
import type { StaffContext, StaffDirectory } from '../application/authenticate.js';

export class PgStaffDirectory implements StaffDirectory {
  constructor(private readonly db: Queryable) {}

  async findByTokenHash(tokenHash: string): Promise<StaffContext | null> {
    const result = await this.db.query<{ name: string; hotel_key: string; hotel_id: string | null; hotel_name: string | null }>(
      `SELECT s.name, s.hotel_key, h.id AS hotel_id, h.name AS hotel_name
       FROM staff_users s LEFT JOIN hotels h ON h.public_key = s.hotel_key
       WHERE s.token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return { name: row.name, hotelKey: row.hotel_key, hotelId: row.hotel_id ?? NIL_UUID, hotelName: row.hotel_name };
  }
}
