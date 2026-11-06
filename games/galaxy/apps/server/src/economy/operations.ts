import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';

/**
 * Runs an economy action once per (account, idempotency key) — GDD §11.3. Concurrent calls with the same key
 * serialize on a transaction-scoped advisory lock: the first runs `fn` and stores its result with the request's
 * hash; the others (and any later retry) get that stored result. The same key with a different request is a
 * 409 idempotency_conflict. If `fn` throws, nothing is stored and a retry runs it again.
 */
export async function runOperation<T>(
  db: Kysely<DB>,
  accountId: string,
  key: string,
  kind: string,
  requestHash: string,
  fn: (trx: Kysely<DB>) => Promise<T>,
): Promise<T> {
  return inTransaction(db, async (trx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${accountId}:${key}`}, 0))`.execute(trx);
    const done = await trx
      .selectFrom('galaxy.operations')
      .select(['request_hash', 'result'])
      .where('account_id', '=', accountId)
      .where('key', '=', key)
      .executeTakeFirst();
    if (done) {
      if (done.request_hash !== requestHash) throw new HttpError(409, 'idempotency_conflict');
      return done.result as T;
    }
    const result = await fn(trx);
    await trx
      .insertInto('galaxy.operations')
      .values({ account_id: accountId, key, kind, request_hash: requestHash, result: JSON.stringify(result ?? null) })
      .execute();
    return result;
  });
}
