import type { Queryable } from '../../../platform/db/queryable.js';
import type { HotelRepository } from '../application/ports.js';
import type { Hotel } from '../domain/hotel.js';

interface HotelRow {
  id: string;
  public_key: string;
  name: string;
  timezone: string;
  currency: string;
  allowed_origins: string[];
}

export class PgHotelRepository implements HotelRepository {
  constructor(private readonly db: Queryable) {}

  async findByPublicKey(publicKey: string): Promise<Hotel | null> {
    const result = await this.db.query<HotelRow>(
      `SELECT id, public_key, name, timezone, currency, allowed_origins
       FROM hotels
       WHERE public_key = $1`,
      [publicKey],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      publicKey: row.public_key,
      name: row.name,
      timezone: row.timezone,
      currency: row.currency,
      allowedOrigins: row.allowed_origins,
    };
  }
}
