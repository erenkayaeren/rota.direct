/**
 * One-shot startup job (compose service `reservation-bootstrap`):
 * apply migrations -> optionally load demo hotels -> make sure inventory rows exist.
 * Exits non-zero on any failure so dependent services never start on a half-prepared database.
 */
import { loadConfig } from '../config.js';
import { ensureInventoryHorizon, horizonStart } from '../modules/inventory/infra/inventory-horizon.js';
import { createPool } from '../platform/db/pool.js';
import { migrate } from '../platform/db/migrator.js';
import { seedDemoData } from '../platform/db/seed.js';

async function run(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, 2);
  try {
    const report = await migrate(pool, config.migrationsDir);
    console.log(
      `[bootstrap] migrations: applied=${report.applied.length} already-applied=${report.alreadyApplied.length}`,
    );

    if (config.seedDemoData) {
      await seedDemoData(pool);
      console.log('[bootstrap] demo hotels upserted');
    }

    const inserted = await ensureInventoryHorizon(pool, horizonStart(new Date()));
    console.log(`[bootstrap] inventory rows created: ${inserted}`);
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[bootstrap] failed', error);
  process.exit(1);
});
