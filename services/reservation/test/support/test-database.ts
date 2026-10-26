import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { ensureInventoryHorizon } from '../../src/modules/inventory/infra/inventory-horizon.js';
import { migrate } from '../../src/platform/db/migrator.js';
import { createPool } from '../../src/platform/db/pool.js';
import { seedDemoData } from '../../src/platform/db/seed.js';
import { addDays } from '../../src/shared/local-date.js';
import { TODAY } from './fixtures.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface TestDatabase {
  pool: Pool;
  drop(): Promise<void>;
}

function serverUrl(): string {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a Postgres server whose user may CREATE DATABASE, e.g. ' +
        'postgres://rota:rota_dev_password@localhost:5432/postgres, or run the suite with ' +
        '`docker compose --profile test run --rm reservation-test`.',
    );
  }
  return url;
}

/**
 * Creates a brand-new database on the test server and drops it again in `drop()`. Every test
 * file gets its own, so files can run in parallel and tests can mutate inventory freely.
 * With `prepare: true` (default) it is migrated, seeded with the demo hotels and given the
 * same inventory horizon production has; with `prepare: false` it is left empty.
 */
export async function createTestDatabase(options: { prepare?: boolean } = {}): Promise<TestDatabase> {
  const prepare = options.prepare ?? true;
  const admin = createPool(serverUrl(), 1);
  const name = `rota_test_${process.pid}_${randomBytes(4).toString('hex')}`;

  const url = new URL(serverUrl());
  url.pathname = `/${name}`;

  let pool: Pool | undefined;
  const drop = async (): Promise<void> => {
    await pool?.end();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  };

  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    pool = createPool(url.toString(), 5);
    if (prepare) {
      await migrate(pool, MIGRATIONS_DIR);
      await seedDemoData(pool);
      await ensureInventoryHorizon(pool, addDays(TODAY, -1));
    }
  } catch (error) {
    await drop();
    throw error;
  }
  return { pool, drop };
}

/** Test helper: set how many rooms of a type are sold on one night (what a booking does). */
export async function setBooked(
  pool: Pool,
  hotelKey: string,
  roomTypeCode: string,
  date: string,
  booked: number,
): Promise<void> {
  const result = await pool.query(
    `UPDATE inventory i
     SET booked = $4
     FROM room_types rt
     JOIN hotels h ON h.id = rt.hotel_id
     WHERE i.hotel_id = rt.hotel_id AND i.room_type_id = rt.id
       AND h.public_key = $1 AND rt.code = $2 AND i.stay_date = $3::date`,
    [hotelKey, roomTypeCode, date, booked],
  );
  if (result.rowCount !== 1) throw new Error(`setBooked touched ${result.rowCount} rows`);
}

/** Test helper: the Postgres error code of a rejected statement (e.g. '23514' check_violation). */
export async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}
