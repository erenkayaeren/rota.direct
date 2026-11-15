import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { migrate } from '../../src/platform/db/migrator.js';
import { createPool } from '../../src/platform/db/pool.js';
import { seedDemoStaff } from '../../src/platform/db/seed.js';

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
        'postgres://rota:rota_dev_password@localhost:5432/postgres, or run `docker compose --profile test run --rm crm-test`.',
    );
  }
  return url;
}

/** A brand-new migrated database (with the demo staff) per test file; dropped again in `drop()`. */
export async function createTestDatabase(options: { poolSize?: number } = {}): Promise<TestDatabase> {
  const admin = createPool(serverUrl(), 1);
  const name = `crm_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  const url = new URL(serverUrl());
  url.pathname = `/${name}`;

  let pool: Pool | undefined;
  const drop = async (): Promise<void> => {
    pool?.removeAllListeners('error');
    pool?.on('error', () => {});
    await pool?.end();
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  };

  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    pool = createPool(url.toString(), options.poolSize ?? 10);
    await migrate(pool, MIGRATIONS_DIR);
    await seedDemoStaff(pool);
  } catch (error) {
    await drop();
    throw error;
  }
  return { pool, drop };
}
