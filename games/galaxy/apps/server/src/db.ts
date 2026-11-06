import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from './db/schema';

/** Pool against Postgres as galaxy_api. Errors surface to callers; health turns them into 503. */
export function createDb(url: string, opts: { max?: number; connectionTimeoutMillis?: number } = {}): Kysely<DB> {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10, connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 5_000 });
  // An idle client that dies (DB restart) must not crash the process.
  pool.on('error', () => {});
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}
