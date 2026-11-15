import { PoisonMessageError } from '../shared/errors.js';
import type { PmsReservation } from '../pms/pms-app.js';

export interface PmsClient {
  /**
   * Creates or updates the reservation in the PMS. Resolves when the PMS accepted it.
   * @throws PoisonMessageError when the PMS will never accept this payload (retrying is pointless)
   * @throws Error for anything that may work later: network errors, timeouts, 5xx, 429, 401/403
   */
  upsert(code: string, reservation: PmsReservation, idempotencyKey: string): Promise<void>;
}

/** 4xx answers that say "this request is wrong", as opposed to "try again later". */
const PERMANENT_STATUSES = new Set([400, 404, 409, 410, 413, 415, 422]);

export class HttpPmsClient implements PmsClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async upsert(code: string, reservation: PmsReservation, idempotencyKey: string): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/api/v1/reservations/${encodeURIComponent(code)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-api-key': this.apiKey, 'idempotency-key': idempotencyKey },
      body: JSON.stringify(reservation),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.ok) return;
    const detail = `PMS answered ${response.status} for ${code}`;
    if (PERMANENT_STATUSES.has(response.status)) throw new PoisonMessageError(detail);
    throw new Error(detail);
  }
}
