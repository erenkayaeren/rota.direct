import type { Pool } from 'pg';

/**
 * What repositories need from the database: something that can run a query. Both a
 * `Pool` and a transaction-bound `PoolClient` satisfy it, so the same
 * repository code works inside and outside a transaction.
 */
export type Queryable = Pick<Pool, 'query'>;
