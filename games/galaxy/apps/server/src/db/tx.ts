import type { Kysely, Transaction } from 'kysely';
import type { DB } from './schema';

/** Runs `fn` in a transaction, or inside the caller's one when `db` already is a transaction (Kysely cannot nest). */
export function inTransaction<T>(db: Kysely<DB>, fn: (trx: Kysely<DB>) => Promise<T>): Promise<T> {
  if (db.isTransaction) return fn(db);
  return db.transaction().execute((trx: Transaction<DB>) => fn(trx));
}
