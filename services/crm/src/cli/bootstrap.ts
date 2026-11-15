/**
 * One-shot startup job (compose service `crm-bootstrap`): apply migrations, optionally load demo
 * staff. Exits non-zero on failure so the CRM never starts against a half-prepared database.
 */
import { loadConfig } from '../config.js';
import { migrate } from '../platform/db/migrator.js';
import { createPool } from '../platform/db/pool.js';
import { seedDemoStaff } from '../platform/db/seed.js';

async function run(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, 2);
  try {
    const report = await migrate(pool, config.migrationsDir);
    console.log(`[crm-bootstrap] migrations: applied=${report.applied.length} already-applied=${report.alreadyApplied.length}`);
    if (config.seedDemoData) {
      await seedDemoStaff(pool);
      console.log('[crm-bootstrap] demo staff upserted');
    }
  } finally {
    await pool.end();
  }
}

run().catch((error) => {
  console.error('[crm-bootstrap] failed', error);
  process.exit(1);
});
