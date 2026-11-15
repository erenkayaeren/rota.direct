import path from 'node:path';
import { z } from 'zod';

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');

const envSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  DATABASE_URL: z.string().min(1),
  /** When unset the service serves the API and panel but does not consume events (useful for local UI work). */
  AMQP_URL: z.string().min(1).optional(),
  LOG_LEVEL: logLevel,
  /** Load demo staff users (with publicly documented tokens) on bootstrap. Never in production. */
  SEED_DEMO_DATA: z.enum(['true', 'false']).default('false'),
  MIGRATIONS_DIR: z.string().min(1).default(path.resolve(process.cwd(), 'migrations')),
  PANEL_DIR: z.string().min(1).default(path.resolve(process.cwd(), 'panel')),
  /** Queue name; one per consuming service so each gets its own copy of every event. */
  CONSUMER_QUEUE: z.string().min(1).default('crm.reservation-events'),
  /** Comma-separated pauses before retry 1, 2, 3 ... */
  CONSUMER_RETRY_DELAYS_MS: z.string().regex(/^\d+(,\d+)*$/).default('1000,5000,30000,120000'),
});

export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  amqpUrl: string | undefined;
  logLevel: z.infer<typeof logLevel>;
  seedDemoData: boolean;
  migrationsDir: string;
  panelDir: string;
  consumerQueue: string;
  consumerRetryDelaysMs: number[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const value = parsed.data;
  return {
    host: value.HOST,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    amqpUrl: value.AMQP_URL,
    logLevel: value.LOG_LEVEL,
    seedDemoData: value.SEED_DEMO_DATA === 'true',
    migrationsDir: value.MIGRATIONS_DIR,
    panelDir: value.PANEL_DIR,
    consumerQueue: value.CONSUMER_QUEUE,
    consumerRetryDelaysMs: value.CONSUMER_RETRY_DELAYS_MS.split(',').map(Number),
  };
}
