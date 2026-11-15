import type { QueryResult, QueryResultRow } from 'pg';

/**
 * What repositories need from the database: something that can run a query. Both a `Pool`
 * and a transaction-bound `PoolClient` satisfy it, so the same repository code works inside
 * and outside a transaction. Declared by hand (instead of `Pick<Pool, 'query'>`) so that
 * it does not depend on pg's overload lists matching between Pool and PoolClient.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
}
