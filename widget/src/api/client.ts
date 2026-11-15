import type {
  AvailabilityResponse,
  CreateReservationBody,
  Reservation,
  SearchInput,
} from './types.js';

/** The server answered with an error. `code` is the stable machine-readable code (see the OpenAPI doc). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** No usable answer at all: offline, DNS, timeout, CORS rejection, or a non-JSON body. */
export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export interface ApiClient {
  availability(search: SearchInput): Promise<AvailabilityResponse>;
  /** `replayed` is true when the server answered an earlier request with the same key. */
  createReservation(body: CreateReservationBody, idempotencyKey: string): Promise<{ reservation: Reservation; replayed: boolean }>;
  cancelReservation(code: string, email: string): Promise<Reservation>;
}

const TIMEOUT_MS = 15_000;

export function createApiClient(
  baseUrl: string,
  hotelKey: string,
  language: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): ApiClient {
  const root = `${baseUrl.replace(/\/+$/, '')}/v1/public/${encodeURIComponent(hotelKey)}`;

  async function request(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<{ body: any; response: Response }> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        ...init,
        headers: { Accept: 'application/json', 'Accept-Language': language, ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new NetworkError('Could not reach the reservation service.', { cause: error });
    }
    let body: any;
    try {
      body = await response.json();
    } catch (error) {
      throw new NetworkError(`Unreadable answer (HTTP ${response.status}).`, { cause: error });
    }
    if (!response.ok) {
      const failure = body?.error;
      throw new ApiError(response.status, String(failure?.code ?? 'UNKNOWN'), String(failure?.message ?? 'Request failed.'), failure?.details);
    }
    return { body, response };
  }

  const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

  return {
    async availability(search) {
      const query = new URLSearchParams({
        checkIn: search.checkIn,
        checkOut: search.checkOut,
        adults: String(search.adults),
        children: String(search.children),
      });
      return (await request(`/availability?${query}`)).body as AvailabilityResponse;
    },

    async createReservation(body, idempotencyKey) {
      const { body: answer, response } = await request('/reservations', {
        ...json(body),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      });
      return { reservation: answer.reservation as Reservation, replayed: response.headers.get('Idempotent-Replayed') === 'true' };
    },

    async cancelReservation(code, email) {
      const { body } = await request(`/reservations/${encodeURIComponent(code.trim())}/cancel`, {
        ...json({ email }),
        headers: { 'Content-Type': 'application/json' },
      });
      return body.reservation as Reservation;
    },
  };
}
