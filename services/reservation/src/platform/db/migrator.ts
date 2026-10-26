import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

const MIGRATION_FILE = /^(\d{3}_[a-z0-9_]+)\.sql$/;
/** Arbitrary application-wide constant; serialises concurrent migrators (e.g. two replicas starting). */
const ADVISORY_LOCK_KEY = 727_001;

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Minimal forward-only SQL migrator.
 *  - files are `NNN_name.sql`, applied in order, each inside its own transaction;
 *  - applied versions are recorded with a SHA-256 checksum, and editing an applied
 *    file is an error (history must be changed with a new migration, never in place);
 *  - a Postgres advisory lock makes concurrent runs safe.
 */
export async function migrate(pool: Pool, dir: string): Promise<MigrationReport> {
  const files = (await readdir(dir)).filter((file) => MIGRATION_FILE.test(file)).sort();
  const report: MigrationReport = { applied: [], alreadyApplied: [] };

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const existing = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const appliedChecksums = new Map(existing.rows.map((row) => [row.version, row.checksum]));

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      const sql = await readFile(path.join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');

      const recorded = appliedChecksums.get(version);
      if (recorded !== undefined) {
        if (recorded !== checksum) {
          throw new Error(
            `Migration ${version} was modified after it was applied. Add a new migration instead of editing it.`,
          );
        }
        report.alreadyApplied.push(version);
        continue;
      }

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          version,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      report.applied.push(version);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return report;
}
