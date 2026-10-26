import { mkdtemp, cp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureInventoryHorizon, INVENTORY_HORIZON_DAYS } from '../../src/modules/inventory/infra/inventory-horizon.js';
import { migrate } from '../../src/platform/db/migrator.js';
import { seedDemoData } from '../../src/platform/db/seed.js';
import { addDays } from '../../src/shared/local-date.js';
import { TODAY } from '../support/fixtures.js';
import {
  createTestDatabase,
  MIGRATIONS_DIR,
  pgErrorCode,
  setBooked,
  type TestDatabase,
} from '../support/test-database.js';

describe('schema guarantees (the database is the last line of defence)', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db?.drop();
  });

  it('refuses booked > total (check_violation), which is what stops overbooking if app code is wrong', async () => {
    const code = await pgErrorCode(
      db.pool.query(`UPDATE inventory SET booked = total + 1 WHERE stay_date = $1::date`, [TODAY]),
    );
    expect(code).toBe('23514');
  });

  it("refuses to link a hotel to another hotel's room type (composite foreign key)", async () => {
    const code = await pgErrorCode(
      db.pool.query(
        `INSERT INTO inventory (hotel_id, room_type_id, stay_date, total)
         SELECT (SELECT id FROM hotels WHERE public_key = 'pk_peri_stone_demo'), id, DATE '2031-01-01', 1
         FROM room_types WHERE code = 'standard'`,
      ),
    );
    expect(code).toBe('23503');
  });

  it('seeds the two demo hotels and five room types from the case study', async () => {
    const result = await db.pool.query<{ key: string; code: string; total_rooms: number; max_guests: number; price: number }>(
      `SELECT h.public_key AS key, rt.code, rt.total_rooms, rt.max_guests, rt.base_price_minor AS price
       FROM room_types rt JOIN hotels h ON h.id = rt.hotel_id
       ORDER BY h.public_key, rt.base_price_minor`,
    );
    expect(result.rows.map((r) => `${r.key}/${r.code}/${r.total_rooms}/${r.max_guests}/${r.price}`)).toEqual([
      'pk_lagos_beach_demo/standard/20/2/320000',
      'pk_lagos_beach_demo/deluxe-sea-view/15/3/480000',
      'pk_lagos_beach_demo/family-suite/5/4/750000',
      'pk_peri_stone_demo/cave-room/8/2/550000',
      'pk_peri_stone_demo/terrace-suite/2/3/900000',
    ]);
  });

  it('re-seeding and re-running the horizon never disturbs existing bookings', async () => {
    await setBooked(db.pool, 'pk_lagos_beach_demo', 'standard', '2026-11-15', 7);

    await seedDemoData(db.pool);
    const inserted = await ensureInventoryHorizon(db.pool, addDays(TODAY, -1));

    expect(inserted).toBe(0);
    const row = await db.pool.query<{ booked: number }>(
      `SELECT i.booked FROM inventory i JOIN room_types rt ON rt.id = i.room_type_id AND rt.hotel_id = i.hotel_id
       WHERE rt.code = 'standard' AND i.stay_date = DATE '2026-11-15'`,
    );
    expect(row.rows[0]?.booked).toBe(7);
  });

  it('extends the horizon with only the missing days as time passes', async () => {
    const inserted = await ensureInventoryHorizon(db.pool, addDays(TODAY, 10));
    expect(inserted).toBe(5 * 10); // 5 room types x the 10 new days at the far end
    expect(INVENTORY_HORIZON_DAYS).toBeGreaterThan(365);
  });
});

describe('migrator', () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase({ prepare: false });
  });
  afterAll(async () => {
    await db?.drop();
  });

  it('applies migrations once and is idempotent', async () => {
    const first = await migrate(db.pool, MIGRATIONS_DIR);
    expect(first.applied).toEqual(['001_init']);
    const second = await migrate(db.pool, MIGRATIONS_DIR);
    expect(second.applied).toHaveLength(0);
    expect(second.alreadyApplied).toEqual(['001_init']);
  });

  it('refuses to continue when an already-applied migration file was edited', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'migrations-'));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await appendFile(path.join(dir, '001_init.sql'), '\n-- edited after being applied\n');

    let message = '';
    try {
      await migrate(db.pool, dir);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('modified after it was applied');
  });
});
