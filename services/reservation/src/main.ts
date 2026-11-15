import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { ensureInventoryHorizon, horizonStart } from './modules/inventory/infra/inventory-horizon.js';
import { createPool } from './platform/db/pool.js';
import { systemClock } from './shared/clock.js';

const HORIZON_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  const app = await buildApp({ pool, logger: { level: config.logLevel }, availabilityCacheTtlMs: config.availabilityCacheTtlMs });

  // Keep inventory rows materialised as days pass. Idempotent, so running it from every
  // replica is harmless.
  const refreshHorizon = async (): Promise<void> => {
    try {
      const inserted = await ensureInventoryHorizon(pool, horizonStart(systemClock.now()));
      app.log.info({ inserted }, 'inventory horizon refreshed');
    } catch (error) {
      app.log.error({ err: error }, 'inventory horizon refresh failed');
    }
  };
  const timer = setInterval(() => void refreshHorizon(), HORIZON_REFRESH_INTERVAL_MS);
  timer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(timer);
    await app.close(); // stop accepting requests, let in-flight ones finish
    await pool.end();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error('Failed to start reservation service', error);
  process.exit(1);
});
