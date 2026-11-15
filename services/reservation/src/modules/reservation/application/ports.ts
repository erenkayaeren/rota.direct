import type { InventoryReader, InventoryStock } from '../../inventory/application/ports.js';
import type { HotelId } from '../../tenancy/domain/hotel.js';
import type { ReservationEvent } from '../domain/events.js';
import type { NewReservation, Reservation } from '../domain/reservation.js';

export interface ReservationRepository {
  /** Inserts the reservation. Returns null if the code is already taken in this hotel (draw another). */
  insert(reservation: NewReservation): Promise<Reservation | null>;
  /** Loads and row-locks the reservation until the transaction ends. null if unknown in this hotel. */
  findByCodeForUpdate(hotelId: HotelId, code: string): Promise<Reservation | null>;
  /** Moves to CANCELLED and bumps the version. Fails loudly if the row changed under us. */
  markCancelled(hotelId: HotelId, id: string, expectedVersion: number, now: Date): Promise<Reservation>;
}

export interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

export type IdempotencyClaim =
  | { readonly kind: 'claimed' }
  | { readonly kind: 'replay'; readonly response: StoredResponse }
  | { readonly kind: 'conflict' };

export interface IdempotencyStore {
  /**
   * Reserves `key` for this transaction. If another transaction holds the same key and is
   * still running, this waits for it; the answer is then 'replay' (it committed) or
   * 'claimed' (it rolled back, so nothing happened yet). 'conflict' = same key, different request.
   */
  claim(hotelId: HotelId, key: string, requestHash: string): Promise<IdempotencyClaim>;
  /** Stores the response to replay; must be called in the same transaction that claimed the key. */
  complete(hotelId: HotelId, key: string, response: StoredResponse): Promise<void>;
}

export interface OutboxWriter {
  append(reservation: Reservation, event: ReservationEvent): Promise<void>;
}

/** Everything that must succeed or fail together, bound to one database transaction. */
export interface ReservationTx {
  readonly stock: InventoryStock;
  /** Catalog reads on the transaction's own connection (never borrow a second one while holding this). */
  readonly roomTypes: Pick<InventoryReader, 'findRoomType'>;
  readonly reservations: ReservationRepository;
  readonly idempotency: IdempotencyStore;
  readonly outbox: OutboxWriter;
}

export interface UnitOfWork {
  /** Runs `work` in a transaction; it may be run more than once if the database asks for a retry. */
  run<T>(work: (tx: ReservationTx) => Promise<T>): Promise<T>;
}

/** One committed, not-yet-published outbox row. */
export interface OutboxRecord {
  readonly id: string;
  /** Global publish order. BIGSERIAL, so it arrives as a string. */
  readonly seq: string;
  readonly hotelId: HotelId;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

/** A batch of unpublished rows, held under the relay lock until the callback returns. */
export interface OutboxBatch {
  readonly records: readonly OutboxRecord[];
  /** Records that these rows reached the broker. Rows not listed stay pending and are retried. */
  markPublished(ids: readonly string[]): Promise<void>;
}

export interface OutboxRelayStore {
  /**
   * Runs `work` with the next batch while holding the single-relay lock. Returns null when
   * another relay holds the lock (nothing was done). The lock is what keeps publish order.
   */
  withBatch<T>(limit: number, work: (batch: OutboxBatch) => Promise<T>): Promise<T | null>;
}

/** The message that crosses the service boundary. This shape is the public event contract (ADR-0006). */
export interface EventEnvelope {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly hotelId: HotelId;
  readonly aggregateId: string;
  readonly version: number;
  readonly data: Record<string, unknown>;
}

export interface EventPublisher {
  /** Resolves only when the broker has durably accepted the message (publisher confirm). */
  publish(event: EventEnvelope): Promise<void>;
}
