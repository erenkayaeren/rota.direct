import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HttpPmsClient } from '../../src/notifier/pms-client.js';
import { buildPmsApp } from '../../src/pms/pms-app.js';
import type { PmsReservation } from '../../src/pms/pms-app.js';
import { PoisonMessageError } from '../../src/shared/errors.js';

const KEY = 'test-api-key-123';
const reservation: PmsReservation = {
  hotelKey: 'pk_lagos_beach_demo',
  status: 'CONFIRMED',
  version: 1,
  guest: { firstName: 'Ayşe', lastName: 'Yılmaz', email: 'ayse@example.com', phone: '+905321234567' },
  stay: { checkIn: '2026-11-10', checkOut: '2026-11-13', adults: 2, children: 0, roomTypeCode: 'standard' },
  totalPriceMinor: 960000,
  currency: 'TRY',
};

let app: FastifyInstance;
let baseUrl: string;
let random = 0.5;

beforeEach(async () => {
  random = 0.5;
  app = await buildPmsApp({ apiKey: KEY, random: () => random });
  baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterEach(async () => {
  await app.close();
});

const client = (timeoutMs = 2000) => new HttpPmsClient(baseUrl, KEY, timeoutMs);
const setMode = (body: object) => app.inject({ method: 'POST', url: '/admin/failure-mode', payload: body });
const stats = async () => (await app.inject({ method: 'GET', url: '/admin/stats' })).json();

describe('fake PMS', () => {
  it('stores a reservation and answers idempotently for the same key', async () => {
    await client().upsert('RT-AAAAAAAA', reservation, 'key-1');
    await client().upsert('RT-AAAAAAAA', reservation, 'key-1'); // redelivery
    expect(await stats()).toMatchObject({ received: 2, accepted: 1, duplicates: 1, stored: 1 });
  });

  it('never lets an older version overwrite a newer one', async () => {
    await client().upsert('RT-BBBBBBBB', { ...reservation, status: 'CANCELLED', version: 2 }, 'key-2');
    await client().upsert('RT-BBBBBBBB', reservation, 'key-3'); // the late created event
    const stored = (await app.inject({ method: 'GET', url: '/api/v1/reservations/RT-BBBBBBBB' })).json();
    expect(stored).toMatchObject({ status: 'CANCELLED', version: 2 });
    expect(await stats()).toMatchObject({ stale: 1 });
  });

  it('rejects calls without the right API key', async () => {
    const response = await app.inject({ method: 'PUT', url: '/api/v1/reservations/RT-X', payload: reservation });
    expect(response.statusCode).toBe(401);
  });
});

describe('HttpPmsClient: telling temporary from permanent failures', () => {
  it('treats a PMS outage (503) as temporary: a plain Error, so the consumer retries', async () => {
    await setMode({ mode: 'down' });
    const error = await client().upsert('RT-CCCCCCCC', reservation, 'k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PoisonMessageError);
    expect(await stats()).toMatchObject({ failedOnPurpose: 1, stored: 0 });
  });

  it('recovers when the PMS comes back, without losing the reservation', async () => {
    await setMode({ mode: 'down' });
    await expect(client().upsert('RT-DDDDDDDD', reservation, 'k')).rejects.toThrow();
    await setMode({ mode: 'ok' });
    await client().upsert('RT-DDDDDDDD', reservation, 'k');
    expect(await stats()).toMatchObject({ stored: 1 });
  });

  it('flaky mode fails only the configured share of calls', async () => {
    await setMode({ mode: 'flaky', rate: 0.3 });
    random = 0.1; // below the rate: fails
    await expect(client().upsert('RT-EEEEEEEE', reservation, 'k1')).rejects.toThrow('503');
    random = 0.9; // above the rate: succeeds
    await client().upsert('RT-EEEEEEEE', reservation, 'k2');
  });

  it('treats a rejected payload (400) as permanent: poison, never retried', async () => {
    const bad = { ...reservation, currency: 'TRYY' } as PmsReservation;
    await expect(client().upsert('RT-FFFFFFFF', bad, 'k')).rejects.toBeInstanceOf(PoisonMessageError);
  });

  it('treats a wrong API key as temporary (an operator can fix it, then replay)', async () => {
    const wrongKey = new HttpPmsClient(baseUrl, 'a-different-key', 2000);
    const error = await wrongKey.upsert('RT-GGGGGGGG', reservation, 'k').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PoisonMessageError);
  });

  it('treats an unreachable PMS as temporary', async () => {
    await app.close();
    await expect(client(500).upsert('RT-HHHHHHHH', reservation, 'k')).rejects.toThrow();
    app = await buildPmsApp({ apiKey: KEY }); // so afterEach can close
  });
});
