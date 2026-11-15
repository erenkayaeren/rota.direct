import { describe, expect, it } from 'vitest';
import { PoisonMessageError } from '../../../src/shared/errors.js';
import { deadQueueName, retryQueueName, routeFailure } from '../../../src/platform/messaging/retrying-consumer.js';

const delays = [1000, 5000, 30000];

describe('routeFailure', () => {
  it('walks through the retry delays in order', () => {
    expect(routeFailure(new Error('db down'), 0, delays)).toEqual({ kind: 'retry', delayMs: 1000, attempt: 1 });
    expect(routeFailure(new Error('db down'), 1, delays)).toEqual({ kind: 'retry', delayMs: 5000, attempt: 2 });
    expect(routeFailure(new Error('db down'), 2, delays)).toEqual({ kind: 'retry', delayMs: 30000, attempt: 3 });
  });

  it('dead-letters once the retries are used up', () => {
    expect(routeFailure(new Error('db down'), 3, delays)).toEqual({ kind: 'dead' });
  });

  it('dead-letters a poison message immediately, without retries', () => {
    expect(routeFailure(new PoisonMessageError('bad payload'), 0, delays)).toEqual({ kind: 'dead' });
  });

  it('dead-letters straight away when no retries are configured', () => {
    expect(routeFailure(new Error('x'), 0, [])).toEqual({ kind: 'dead' });
  });
});

describe('queue names', () => {
  it('derives retry and dead queues from the main queue', () => {
    expect(retryQueueName('crm.reservation-events', 5000)).toBe('crm.reservation-events.retry.5000ms');
    expect(deadQueueName('crm.reservation-events')).toBe('crm.reservation-events.dead');
  });
});
