import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Load the two demo hotels from the case study on bootstrap. */
  SEED_DEMO_DATA: z.enum(['true', 'false']).default('false'),
  MIGRATIONS_DIR: z.string().min(1).default(path.resolve(process.cwd(), 'migrations')),
  /** How long an availability answer is reused in memory (S6). 0 disables the cache. */
  AVAILABILITY_CACHE_TTL_MS: z.coerce.number().int().min(0).max(300_000).default(10_000),
});

export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  seedDemoData: boolean;
  migrationsDir: string;
  availabilityCacheTtlMs: number;
}

/** Reads and validates environment variables once, at startup, failing fast with a clear message. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const value = parsed.data;
  return {
    host: value.HOST,
    port: value.PORT,
    databaseUrl: value.DATABASE_URL,
    logLevel: value.LOG_LEVEL,
    seedDemoData: value.SEED_DEMO_DATA === 'true',
    migrationsDir: value.MIGRATIONS_DIR,
    availabilityCacheTtlMs: value.AVAILABILITY_CACHE_TTL_MS,
  };
}

const relayEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  AMQP_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RELAY_POLL_INTERVAL_MS: z.coerce.number().int().min(10).default(500),
  RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export interface RelayConfig {
  databaseUrl: string;
  amqpUrl: string;
  pollIntervalMs: number;
  batchSize: number;
  healthPort: number;
}

/** Settings of the outbox relay process (`dist/cli/relay.js`). */
export function loadRelayConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const parsed = relayEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  const value = parsed.data;
  return {
    databaseUrl: value.DATABASE_URL,
    amqpUrl: value.AMQP_URL,
    pollIntervalMs: value.RELAY_POLL_INTERVAL_MS,
    batchSize: value.RELAY_BATCH_SIZE,
    healthPort: value.HEALTH_PORT,
  };
}
