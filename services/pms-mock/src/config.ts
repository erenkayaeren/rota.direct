import { z } from 'zod';

const logLevel = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info');

const serverSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3200),
  PMS_API_KEY: z.string().min(8).default('pms-demo-key'),
  /** Initial behaviour; can be changed at runtime through POST /admin/failure-mode. */
  PMS_FAILURE_MODE: z.enum(['ok', 'down', 'flaky']).default('ok'),
  PMS_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.5),
  LOG_LEVEL: logLevel,
});

const workerSchema = z.object({
  AMQP_URL: z.string().min(1),
  PMS_BASE_URL: z.string().url(),
  PMS_API_KEY: z.string().min(8).default('pms-demo-key'),
  PMS_TIMEOUT_MS: z.coerce.number().int().min(100).default(3000),
  CONSUMER_QUEUE: z.string().min(1).default('pms.reservation-events'),
  CONSUMER_RETRY_DELAYS_MS: z.string().regex(/^\d+(,\d+)*$/).default('2000,10000,30000,60000,300000'),
  MAIL_QUEUE: z.string().min(1).default('mail.reservation-events'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3201),
});

function parse<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return result.data;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = parse(serverSchema, env);
  return {
    host: value.HOST,
    port: value.PORT,
    apiKey: value.PMS_API_KEY,
    failureMode: value.PMS_FAILURE_MODE,
    failureRate: value.PMS_FAILURE_RATE,
    logLevel: value.LOG_LEVEL,
  };
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  const value = parse(workerSchema, env);
  return {
    amqpUrl: value.AMQP_URL,
    pmsBaseUrl: value.PMS_BASE_URL,
    apiKey: value.PMS_API_KEY,
    timeoutMs: value.PMS_TIMEOUT_MS,
    queue: value.CONSUMER_QUEUE,
    retryDelaysMs: value.CONSUMER_RETRY_DELAYS_MS.split(',').map(Number),
    mailQueue: value.MAIL_QUEUE,
    healthPort: value.HEALTH_PORT,
  };
}
