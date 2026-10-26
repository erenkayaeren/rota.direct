import pg from 'pg';
import type { Pool } from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings. The default parser builds a JS Date at
// local midnight, which shifts the calendar day depending on the server's time zone.
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export function createPool(connectionString: string, max = 10): Pool {
  const pool = new pg.Pool({ connectionString, max });
  // An error on an idle client (e.g. the database restarted) must not crash the process.
  pool.on('error', (error) => {
    console.error('Unexpected error on idle database client', error);
  });
  return pool;
}
