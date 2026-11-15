import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { ProjectReservationEvent } from '../../src/modules/guests/application/project-reservation-event.js';
import { PgProjectionStore } from '../../src/modules/guests/infra/pg-projection-store.js';
import { LAGOS, PERI, reservationEvent } from '../support/events.js';
import { createTestDatabase, type TestDatabase } from '../support/test-database.js';

const LAGOS_AUTH = { authorization: 'Bearer demo-lagos-staff-token-0001' };
const PERI_AUTH = { authorization: 'Bearer demo-peri-staff-token-0002' };

let db: TestDatabase;
let app: FastifyInstance;

async function list(query: Record<string, string> = {}, headers = LAGOS_AUTH) {
  return app.inject({ method: 'GET', url: '/api/v1/guests', query, headers });
}

beforeAll(async () => {
  db = await createTestDatabase();
  app = await buildApp({ pool: db.pool });
  await app.ready();
  const projector = new ProjectReservationEvent(new PgProjectionStore(db.pool));

  // Lagos: Ayşe (2 stays, 1 cancelled), Mehmet, plus 25 filler guests for pagination.
  await projector.handle(reservationEvent({ email: 'ayse@example.com', firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321234567', code: 'RT-AYSE0001', totalPriceMinor: 960_000, marketing: true, createdAt: '2026-08-01T10:00:00.000Z' }));
  await projector.handle(reservationEvent({ email: 'ayse@example.com', firstName: 'Ayşe', lastName: 'Yılmaz', phone: '+905321234567', code: 'RT-AYSE0002', totalPriceMinor: 320_000, checkIn: '2026-12-01', checkOut: '2026-12-02', marketing: true, createdAt: '2026-09-01T10:00:00.000Z' }));
  const cancelId = '44444444-dddd-4ddd-8ddd-444444444444';
  await projector.handle(reservationEvent({ reservationId: cancelId, email: 'ayse@example.com', code: 'RT-AYSE0003', totalPriceMinor: 111_000, createdAt: '2026-09-02T10:00:00.000Z', marketing: true }));
  await projector.handle(reservationEvent({ reservationId: cancelId, type: 'reservation.cancelled', email: 'ayse@example.com', code: 'RT-AYSE0003', totalPriceMinor: 111_000, createdAt: '2026-09-02T10:00:00.000Z', marketing: true }));
  await projector.handle(reservationEvent({ email: 'mehmet@example.com', firstName: 'Mehmet', lastName: 'Demir', phone: '+905441112233', code: 'RT-MEHM0001', totalPriceMinor: 1_500_000, createdAt: '2026-10-01T10:00:00.000Z' }));
  for (let i = 0; i < 25; i++) {
    const n = String(i).padStart(2, '0');
    await projector.handle(reservationEvent({ email: `filler${n}@example.com`, firstName: `Filler${n}`, lastName: 'Konuk', phone: `+90555000${n}${n}`, code: `RT-FILL00${n}`, createdAt: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00.000Z` }));
  }
  // Peri: one guest that Lagos staff must never see
  await projector.handle(reservationEvent({ hotel: PERI, email: 'peri.guest@example.com', firstName: 'Periguest', code: 'RT-PERI0001' }));
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('staff authentication', () => {
  it.each([
    ['no header', {}],
    ['wrong scheme', { authorization: 'Basic abc' }],
    ['unknown token', { authorization: 'Bearer this-token-does-not-exist' }],
    ['too short token', { authorization: 'Bearer abc' }],
  ])('401 for %s', async (_name, headers) => {
    const response = await list({}, headers as typeof LAGOS_AUTH);
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
    expect(response.headers['www-authenticate']).toBe('Bearer');
  });

  it('identifies the staff user and their hotel', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers: LAGOS_AUTH });
    expect(response.json()).toEqual({ name: 'Lagos Resepsiyon', hotel: { key: LAGOS.key, name: LAGOS.name } });
  });

  it('never caches personal data', async () => {
    expect((await list()).headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/v1/guests (M12)', () => {
  it('lists only the staff user\'s own hotel', async () => {
    const lagos = (await list({ pageSize: '100' })).json();
    expect(lagos.total).toBe(27);
    expect(lagos.items.map((g: { email: string }) => g.email)).not.toContain('peri.guest@example.com');
    const peri = (await list({}, PERI_AUTH)).json();
    expect(peri.items.map((g: { email: string }) => g.email)).toEqual(['peri.guest@example.com']);
  });

  it('paginates with a stable total', async () => {
    const first = (await list({ page: '1', pageSize: '10', sort: 'name' })).json();
    const third = (await list({ page: '3', pageSize: '10', sort: 'name' })).json();
    const last = (await list({ page: '4', pageSize: '10', sort: 'name' })).json();
    expect(first).toMatchObject({ page: 1, pageSize: 10, total: 27 });
    expect(first.items).toHaveLength(10);
    expect(third.items).toHaveLength(7);
    expect(last.items).toHaveLength(0);
    const seen = [...first.items, ...(await list({ page: '2', pageSize: '10', sort: 'name' })).json().items, ...third.items];
    expect(new Set(seen.map((g: { id: string }) => g.id)).size).toBe(27); // no overlaps, none missing
  });

  it('computes stats from non-cancelled stays only', async () => {
    const ayse = (await list({ q: 'ayse@' })).json().items[0];
    expect(ayse.stats).toEqual({ reservations: 2, cancelled: 1, nights: 4, spentMinor: 1_280_000, currency: 'TRY', lastCheckIn: '2026-12-01' });
    expect(ayse.marketingConsent).toBe(true);
  });

  it.each([
    ['name', 'yılmaz', ['ayse@example.com']],
    ['full name', 'Ayşe Yıl', ['ayse@example.com']],
    ['email fragment', 'mehmet@', ['mehmet@example.com']],
    ['reservation code', 'rt-mehm0001', ['mehmet@example.com']],
    ['phone with national format', '0544 111', ['mehmet@example.com']],
    ['phone with spaces', '+90 544 111 22 33', ['mehmet@example.com']],
  ])('searches by %s', async (_name, q, emails) => {
    const result = (await list({ q })).json();
    expect(result.items.map((g: { email: string }) => g.email)).toEqual(emails);
  });

  it('treats % and _ in the search text literally', async () => {
    expect((await list({ q: '%' })).json().total).toBe(0);
    expect((await list({ q: 'filler_' })).json().total).toBe(0);
  });

  it('filters by marketing consent', async () => {
    expect((await list({ marketing: 'true' })).json().total).toBe(1);
    expect((await list({ marketing: 'false' })).json().total).toBe(26);
  });

  it('sorts by spend and by recent booking', async () => {
    expect((await list({ sort: 'spend' })).json().items[0].email).toBe('mehmet@example.com');
    expect((await list({ sort: 'recent' })).json().items[0].email).toBe('mehmet@example.com'); // booked 2026-10-01
  });

  it.each([
    ['page=0', { page: '0' }],
    ['pageSize=101', { pageSize: '101' }],
    ['pageSize=abc', { pageSize: 'abc' }],
    ['sort=nope', { sort: 'nope' }],
    ['marketing=maybe', { marketing: 'maybe' }],
  ])('400 for %s', async (_name, query) => {
    const response = await list(query);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('INVALID_REQUEST');
  });
});

describe('GET /api/v1/guests/:id', () => {
  const idOf = async (q: string, headers = LAGOS_AUTH): Promise<string> => (await list({ q }, headers)).json().items[0].id;

  it('returns the profile with reservations (newest stay first), consents and no notes yet', async () => {
    const id = await idOf('ayse@');
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/guests/${id}`, headers: LAGOS_AUTH })).json();
    expect(detail).toMatchObject({ email: 'ayse@example.com', firstName: 'Ayşe', notes: [], tags: [], possibleDuplicates: [] });
    expect(detail.reservations.map((r: { code: string; status: string }) => `${r.code}:${r.status}`)).toEqual([
      'RT-AYSE0002:CONFIRMED',
      'RT-AYSE0003:CANCELLED',
      'RT-AYSE0001:CONFIRMED',
    ]);
    expect(detail.reservations[0]).toMatchObject({ nights: 1, roomType: { code: 'standard', name: { tr: 'Standart' } } });
    expect(detail.marketingConsentedAt).toBe('2026-09-02T10:00:00.000Z');
    expect(detail.kvkkAcceptedAt).toBeTruthy();
  });

  it("404s for another hotel's guest and for an unknown id, 400 for a malformed id", async () => {
    const periGuest = await idOf('peri.guest', PERI_AUTH);
    const other = await app.inject({ method: 'GET', url: `/api/v1/guests/${periGuest}`, headers: LAGOS_AUTH });
    expect(other.statusCode).toBe(404);
    expect(other.json().error.code).toBe('GUEST_NOT_FOUND');
    expect((await app.inject({ method: 'GET', url: '/api/v1/guests/99999999-9999-4999-8999-999999999999', headers: LAGOS_AUTH })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/guests/not-a-uuid', headers: LAGOS_AUTH })).statusCode).toBe(400);
  });

  it('hints at possible duplicates (same phone) without merging them', async () => {
    const projector = new ProjectReservationEvent(new PgProjectionStore(db.pool));
    await projector.handle(reservationEvent({ email: 'ayse.alt@example.com', firstName: 'Ayse', phone: '+905321234567', code: 'RT-ALT00001' }));
    const id = await idOf('ayse@');
    const detail = (await app.inject({ method: 'GET', url: `/api/v1/guests/${id}`, headers: LAGOS_AUTH })).json();
    expect(detail.possibleDuplicates.map((d: { email: string }) => d.email)).toEqual(['ayse.alt@example.com']);
  });
});

describe('notes and tags (M12)', () => {
  it('adds notes, attributed to the staff user, newest first', async () => {
    const id = (await list({ q: 'mehmet@' })).json().items[0].id;
    const post = (body: unknown) => app.inject({ method: 'POST', url: `/api/v1/guests/${id}/notes`, headers: LAGOS_AUTH, payload: body as object });

    const first = await post({ body: '  Deniz manzarası istedi.  ' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ body: 'Deniz manzarası istedi.', author: 'Lagos Resepsiyon' });
    await post({ body: 'Geç check-in yapacak.' });

    const detail = (await app.inject({ method: 'GET', url: `/api/v1/guests/${id}`, headers: LAGOS_AUTH })).json();
    expect(detail.notes.map((n: { body: string }) => n.body)).toEqual(['Geç check-in yapacak.', 'Deniz manzarası istedi.']);

    expect((await post({ body: '   ' })).statusCode).toBe(422);
    expect((await post({ body: 'x', extra: 1 })).statusCode).toBe(400);
  });

  it("does not let staff of one hotel write to another hotel's guest", async () => {
    const periGuest = (await list({ q: 'peri.guest' }, PERI_AUTH)).json().items[0].id;
    const note = await app.inject({ method: 'POST', url: `/api/v1/guests/${periGuest}/notes`, headers: LAGOS_AUTH, payload: { body: 'hello' } });
    const tags = await app.inject({ method: 'PUT', url: `/api/v1/guests/${periGuest}/tags`, headers: LAGOS_AUTH, payload: { tags: ['vip'] } });
    expect([note.statusCode, tags.statusCode]).toEqual([404, 404]);
    expect((await db.pool.query('SELECT 1 FROM guest_notes WHERE guest_id = $1', [periGuest])).rowCount).toBe(0);
  });

  it('replaces the tag set, normalizes tags, and makes guests filterable by tag', async () => {
    const id = (await list({ q: 'ayse@' })).json().items[0].id;
    const put = (tags: unknown) => app.inject({ method: 'PUT', url: `/api/v1/guests/${id}/tags`, headers: LAGOS_AUTH, payload: { tags } as object });

    const saved = await put(['VIP', ' Sadık Misafir ', 'vip']);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ tags: ['sadık-misafir', 'vip'] });
    expect((await list({ tag: 'VIP' })).json().items.map((g: { email: string }) => g.email)).toEqual(['ayse@example.com']);

    expect((await put(['vip'])).json()).toEqual({ tags: ['vip'] });
    expect((await list({ tag: 'sadık-misafir' })).json().total).toBe(0);
    expect((await put([])).json()).toEqual({ tags: [] });
    expect((await put(['<script>'])).statusCode).toBe(422);
    expect((await put('vip')).statusCode).toBe(400);
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ status: 'ok' });
    expect((await app.inject({ method: 'GET', url: '/health/ready' })).json()).toEqual({ status: 'ok', consumer: 'disabled' });
  });
});

describe('staff panel (static files)', () => {
  it('serves the panel with a strict Content-Security-Policy, and only the API needs a token', async () => {
    const withPanel = await buildApp({ pool: db.pool, panelDir: new URL('../../panel', import.meta.url).pathname });
    await withPanel.ready();
    const page = await withPanel.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'self'");
    expect(page.headers['x-content-type-options']).toBe('nosniff');
    expect((await withPanel.inject({ method: 'GET', url: '/app.js' })).statusCode).toBe(200);
    expect((await withPanel.inject({ method: 'GET', url: '/api/v1/guests' })).statusCode).toBe(401);
    expect((await withPanel.inject({ method: 'GET', url: '/api/v1/guests' })).headers['content-security-policy']).toBeUndefined();
    await withPanel.close();
  });
});
