import type { Pool } from 'pg';
import { withTransaction } from '../../../platform/db/transaction.js';
import { PgInventoryReader } from '../../inventory/infra/pg-inventory-reader.js';
import { PgInventoryStock } from '../../inventory/infra/pg-inventory-stock.js';
import type { ReservationTx, UnitOfWork } from '../application/ports.js';
import { PgIdempotencyStore } from './pg-idempotency-store.js';
import { PgOutbox } from './pg-outbox.js';
import { PgReservationRepository } from './pg-reservation-repository.js';

/** Binds every adapter to the same transaction connection. */
export class PgUnitOfWork implements UnitOfWork {
  constructor(private readonly pool: Pool) {}

  run<T>(work: (tx: ReservationTx) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, (client) =>
      work({
        stock: new PgInventoryStock(client),
        roomTypes: new PgInventoryReader(client),
        reservations: new PgReservationRepository(client),
        idempotency: new PgIdempotencyStore(client),
        outbox: new PgOutbox(client),
      }),
    );
  }
}
