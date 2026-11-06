import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { hashToken, newToken } from './tokens';

/** Second login step for role holders: a short-lived random token (stored as sha256) tied to the account. */
export async function createChallenge(db: Kysely<DB>, accountId: string, ttlMs = 300_000): Promise<string> {
  const { token, hash } = newToken();
  await db
    .insertInto('galaxy.login_challenges')
    .values({ account_id: accountId, token_hash: hash, expires_at: sql<Date>`now() + make_interval(secs => ${ttlMs / 1000})` })
    .execute();
  return token;
}

/** The account behind a live (unused, unexpired) challenge, without consuming it. */
export async function peekChallenge(db: Kysely<DB>, token: string, now: Date): Promise<string | null> {
  const row = await db
    .selectFrom('galaxy.login_challenges')
    .select('account_id')
    .where('token_hash', '=', hashToken(token))
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();
  return row?.account_id ?? null;
}

/** Marks a live challenge used and returns its account; null if it was already used, expired or unknown. */
export async function consumeChallenge(db: Kysely<DB>, token: string, now: Date): Promise<string | null> {
  const row = await db
    .updateTable('galaxy.login_challenges')
    .set({ used_at: now })
    .where('token_hash', '=', hashToken(token))
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .returning('account_id')
    .executeTakeFirst();
  return row?.account_id ?? null;
}
