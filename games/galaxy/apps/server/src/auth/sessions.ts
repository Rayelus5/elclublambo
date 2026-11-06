import type { Role } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { hashToken, newToken } from './tokens';

export type SessionInfo = {
  sessionId: string;
  accountId: string;
  username: string;
  roles: Role[];
  mfa: boolean;
};

const TOUCH_EVERY_MS = 5 * 60 * 1000;

export async function createSession(
  db: Kysely<DB>,
  accountId: string,
  opts: { ip: string; userAgent: string; mfa: boolean; ttlMs: number },
): Promise<string> {
  const { token, hash } = newToken();
  await db
    .insertInto('galaxy.sessions')
    .values({
      account_id: accountId,
      token_hash: hash,
      mfa: opts.mfa,
      expires_at: sql<Date>`now() + make_interval(secs => ${opts.ttlMs / 1000})`,
      ip: opts.ip === 'unknown' ? null : opts.ip,
      user_agent: opts.userAgent.slice(0, 400),
    })
    .execute();
  return token;
}

export async function rolesOf(db: Kysely<DB>, accountId: string): Promise<Role[]> {
  const rows = await db
    .selectFrom('galaxy.account_roles')
    .select('role')
    .where('account_id', '=', accountId)
    .orderBy('role')
    .execute();
  return rows.map((r) => r.role);
}

/**
 * The live session behind a cookie token, or null: unknown, expired, or belonging to a banned account. Refreshes
 * last_seen_at at most every 5 minutes so that reads do not turn into a write per request.
 */
export async function readSession(db: Kysely<DB>, token: string, now: Date): Promise<SessionInfo | null> {
  const row = await db
    .selectFrom('galaxy.sessions as s')
    .innerJoin('galaxy.accounts as a', 'a.id', 's.account_id')
    .select(['s.id', 's.account_id', 's.mfa', 's.last_seen_at', 'a.username'])
    .where('s.token_hash', '=', hashToken(token))
    .where('s.expires_at', '>', now)
    .where((eb) => eb.or([eb('a.banned_until', 'is', null), eb('a.banned_until', '<=', now)]))
    .executeTakeFirst();
  if (!row) return null;
  if (now.getTime() - row.last_seen_at.getTime() >= TOUCH_EVERY_MS) {
    await db.updateTable('galaxy.sessions').set({ last_seen_at: now }).where('id', '=', row.id).execute();
  }
  return {
    sessionId: row.id,
    accountId: row.account_id,
    username: row.username,
    roles: await rolesOf(db, row.account_id),
    mfa: row.mfa,
  };
}

export async function revokeSession(db: Kysely<DB>, token: string): Promise<void> {
  await db.deleteFrom('galaxy.sessions').where('token_hash', '=', hashToken(token)).execute();
}

export async function revokeAllSessions(db: Kysely<DB>, accountId: string): Promise<void> {
  await db.deleteFrom('galaxy.sessions').where('account_id', '=', accountId).execute();
}
