import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient, NetworkError } from '../src/api/client.js';

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}
const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('api client', () => {
  it('asks for availability with the right URL, query and language', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { stay: {}, roomTypes: [] }));
    const client = createApiClient('http://api.test/', 'pk_lagos_beach_demo', 'tr', impl);
    await client.availability({ checkIn: '2026-11-01', checkOut: '2026-11-04', adults: 2, children: 1 });
    expect(calls[0]?.url).toBe('http://api.test/v1/public/pk_lagos_beach_demo/availability?checkIn=2026-11-01&checkOut=2026-11-04&adults=2&children=1');
    expect((calls[0]?.init.headers as Record<string, string>)['Accept-Language']).toBe('tr');
  });

  it('sends the Idempotency-Key and reports a replayed answer', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(201, { reservation: { code: 'RT-ABCDEFGH' } }, { 'Idempotent-Replayed': 'true' }));
    const client = createApiClient('http://api.test', 'pk_lagos_beach_demo', 'en', impl);
    const result = await client.createReservation({} as never, 'key-0123456789abcdef');
    expect(result).toEqual({ reservation: { code: 'RT-ABCDEFGH' }, replayed: true });
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-0123456789abcdef');
  });

  it('turns an error body into an ApiError with the stable code', async () => {
    const { impl } = fakeFetch(() => jsonResponse(409, { error: { code: 'SOLD_OUT', message: 'gone', details: { roomTypeId: 'x' } } }));
    const error = await createApiClient('http://api.test', 'pk_lagos_beach_demo', 'en', impl)
      .createReservation({} as never, 'k'.repeat(16)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: 'SOLD_OUT', details: { roomTypeId: 'x' } });
  });

  it('URL-encodes the reservation code when cancelling', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse(200, { reservation: { code: 'x' } }));
    await createApiClient('http://api.test', 'pk_lagos_beach_demo', 'en', impl).cancelReservation(' RT-AB/CD ', 'a@b.co');
    expect(calls[0]?.url).toBe('http://api.test/v1/public/pk_lagos_beach_demo/reservations/RT-AB%2FCD/cancel');
    expect(calls[0]?.init.body).toBe('{"email":"a@b.co"}');
  });

  it('reports network failures and unreadable answers as NetworkError', async () => {
    const down = fakeFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(createApiClient('http://api.test', 'pk_lagos_beach_demo', 'en', down.impl).availability({} as never)).rejects.toBeInstanceOf(NetworkError);
    const html = fakeFetch(() => new Response('<html>502</html>', { status: 502 }));
    await expect(createApiClient('http://api.test', 'pk_lagos_beach_demo', 'en', html.impl).availability({} as never)).rejects.toBeInstanceOf(NetworkError);
  });
});
