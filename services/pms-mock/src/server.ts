import { loadServerConfig } from './config.js';
import { buildPmsApp, type FailureMode } from './pms/pms-app.js';

async function main(): Promise<void> {
  const config = loadServerConfig();
  const failure: FailureMode =
    config.failureMode === 'flaky' ? { mode: 'flaky', rate: config.failureRate } : { mode: config.failureMode };
  const app = await buildPmsApp({ apiKey: config.apiKey, failure, logger: { level: config.logLevel } });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error('Failed to start PMS mock', error);
  process.exit(1);
});
