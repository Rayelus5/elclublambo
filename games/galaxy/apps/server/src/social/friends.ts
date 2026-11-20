import { type AccountConfig, type ConfigValue, type FriendRelation, type FriendsView, levelOf, type Presence, type SocialPrefs, type SocialPrefsRequest } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// Friends and blocks (multiplayer plan, phase 3). A friendship is one row per pair, ordered (a < b), first pending
// (who asked in requested_by) and then accepted; declining, cancelling and removing delete it. Asking someone who has
// already asked you accepts at once. A block works both ways for everything social and ends whatever was between the
// two; being blocked looks like the account does not exist (404), so a block is never revealed. Each change returns
// whom to tell (the live socket), and the caller pushes it after the transaction.

type SocialConfig = ConfigValue<'social'>;

export const DEFAULT_PREFS: SocialPrefs = { invites: 'friends', showStatus: true, notices: 'sound' };

const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

async function accountByName(db: Kysely<DB>, username: string): Promise<{ id: string; username: string }> {
  const row = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('username', '=', username).executeTakeFirst();
  if (!row) throw new HttpError(404, 'player_not_found');
  return row;
}

/** Whether either account blocked the other. */
export async function blockedBetween(db: Kysely<DB>, x: string, y: string): Promise<{ mine: boolean; theirs: boolean }> {
  const rows = await db
    .selectFrom('galaxy.blocks')
    .select(['blocker'])
    .where((eb) => eb.or([eb.and([eb('blocker', '=', x), eb('blocked', '=', y)]), eb.and([eb('blocker', '=', y), eb('blocked', '=', x)])]))
    .execute();
  return { mine: rows.some((r) => r.blocker === x), theirs: rows.some((r) => r.blocker === y) };
}

/** The ids of an account's accepted friends. */
export async function friendIdsOf(db: Kysely<DB>, accountId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('galaxy.friendships')
    .select(sql<string>`case when a = ${accountId}::uuid then b else a end`.as('other'))
    .where('status', '=', 'accepted')
    .where((eb) => eb.or([eb('a', '=', accountId), eb('b', '=', accountId)]))
    .execute();
  return rows.map((r) => r.other);
}

export async function areFriends(db: Kysely<DB>, x: string, y: string): Promise<boolean> {
  const [a, b] = pair(x, y);
  const row = await db.selectFrom('galaxy.friendships').select('status').where('a', '=', a).where('b', '=', b).executeTakeFirst();
  return row?.status === 'accepted';
}

async function friendCount(db: Kysely<DB>, accountId: string): Promise<number> {
  const row = await db
    .selectFrom('galaxy.friendships')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('status', '=', 'accepted')
    .where((eb) => eb.or([eb('a', '=', accountId), eb('b', '=', accountId)]))
    .executeTakeFirstOrThrow();
  return row.n;
}

export async function prefsOf(db: Kysely<DB>, accountId: string): Promise<SocialPrefs> {
  const row = await db.selectFrom('galaxy.social_prefs').select(['invites', 'show_status', 'notices']).where('account_id', '=', accountId).executeTakeFirst();
  return row ? { invites: row.invites as SocialPrefs['invites'], showStatus: row.show_status, notices: row.notices as SocialPrefs['notices'] } : DEFAULT_PREFS;
}

/** Saves the prefs; a request without `notices` (a tab from before them) keeps the saved one. */
export async function setPrefs(db: Kysely<DB>, accountId: string, prefs: SocialPrefsRequest, now: Date): Promise<SocialPrefs> {
  const notices = prefs.notices !== undefined ? { notices: prefs.notices } : {};
  await db
    .insertInto('galaxy.social_prefs')
    .values({ account_id: accountId, invites: prefs.invites, show_status: prefs.showStatus, ...notices, updated_at: now })
    .onConflict((oc) => oc.column('account_id').doUpdateSet({ invites: prefs.invites, show_status: prefs.showStatus, ...notices, updated_at: now }))
    .execute();
  return prefsOf(db, accountId);
}

/** Whom a change concerns, for the live socket: the other account and why. */
export type FriendChange = { other: string; otherName: string; reason: 'request' | 'accepted' | 'removed' | 'declined' | 'blocked' };

/**
 * Asks `username` to be friends. If they already asked, it is accepted. 404 for a missing account or one that
 * blocked me; friend_blocked when I blocked them (unblock first); friend_exists when already friends or asked.
 */
export async function requestFriend(trx: Kysely<DB>, cfg: SocialConfig, me: string, username: string, now: Date): Promise<FriendChange> {
  const other = await accountByName(trx, username);
  if (other.id === me) throw new HttpError(409, 'friend_self');
  const blocks = await blockedBetween(trx, me, other.id);
  if (blocks.theirs) throw new HttpError(404, 'player_not_found');
  if (blocks.mine) throw new HttpError(409, 'friend_blocked');
  const [a, b] = pair(me, other.id);
  // The pair's row, locked: two requests crossing at the same time end as one friendship.
  await trx.selectFrom('galaxy.accounts').select('id').where('id', 'in', [a, b]).orderBy('id').forUpdate().execute();
  const row = await trx.selectFrom('galaxy.friendships').selectAll().where('a', '=', a).where('b', '=', b).executeTakeFirst();
  if (row?.status === 'accepted' || (row && row.requested_by === me)) throw new HttpError(409, 'friend_exists');
  if ((await friendCount(trx, me)) >= cfg.maxFriends) throw new HttpError(409, 'friend_limit');
  if (row) {
    // They asked first: this is an answer.
    if ((await friendCount(trx, other.id)) >= cfg.maxFriends) throw new HttpError(409, 'friend_limit_them');
    await trx.updateTable('galaxy.friendships').set({ status: 'accepted', accepted_at: now }).where('a', '=', a).where('b', '=', b).execute();
    return { other: other.id, otherName: other.username, reason: 'accepted' };
  }
  await trx.insertInto('galaxy.friendships').values({ a, b, status: 'pending', requested_by: me, created_at: now }).execute();
  return { other: other.id, otherName: other.username, reason: 'request' };
}

/** Accepts a request `username` sent me. */
export async function acceptFriend(trx: Kysely<DB>, cfg: SocialConfig, me: string, username: string, now: Date): Promise<FriendChange> {
  const other = await accountByName(trx, username);
  const [a, b] = pair(me, other.id);
  await trx.selectFrom('galaxy.accounts').select('id').where('id', 'in', [a, b]).orderBy('id').forUpdate().execute();
  const row = await trx.selectFrom('galaxy.friendships').selectAll().where('a', '=', a).where('b', '=', b).executeTakeFirst();
  if (!row || row.status !== 'pending' || row.requested_by !== other.id) throw new HttpError(404, 'friend_request_missing');
  if ((await friendCount(trx, me)) >= cfg.maxFriends) throw new HttpError(409, 'friend_limit');
  if ((await friendCount(trx, other.id)) >= cfg.maxFriends) throw new HttpError(409, 'friend_limit_them');
  await trx.updateTable('galaxy.friendships').set({ status: 'accepted', accepted_at: now }).where('a', '=', a).where('b', '=', b).execute();
  return { other: other.id, otherName: other.username, reason: 'accepted' };
}

/**
 * Ends what is between me and `username`: declines their request, cancels mine or removes the friendship (the same
 * row in every case). 404 when there is nothing.
 */
export async function endFriendship(trx: Kysely<DB>, me: string, username: string): Promise<FriendChange> {
  const other = await accountByName(trx, username);
  const [a, b] = pair(me, other.id);
  const row = await trx.deleteFrom('galaxy.friendships').where('a', '=', a).where('b', '=', b).returning(['status', 'requested_by']).executeTakeFirst();
  if (!row) throw new HttpError(404, 'friend_request_missing');
  const reason = row.status === 'accepted' ? 'removed' : row.requested_by === me ? 'removed' : 'declined';
  return { other: other.id, otherName: other.username, reason };
}

/** Blocks `username`: whatever was between us ends, and nothing social passes either way until unblocked. */
export async function blockAccount(trx: Kysely<DB>, me: string, username: string, now: Date): Promise<FriendChange> {
  const other = await accountByName(trx, username);
  if (other.id === me) throw new HttpError(409, 'friend_self');
  const [a, b] = pair(me, other.id);
  await trx.deleteFrom('galaxy.friendships').where('a', '=', a).where('b', '=', b).execute();
  await trx.insertInto('galaxy.blocks').values({ blocker: me, blocked: other.id, created_at: now }).onConflict((oc) => oc.doNothing()).execute();
  return { other: other.id, otherName: other.username, reason: 'blocked' };
}

export async function unblockAccount(db: Kysely<DB>, me: string, username: string): Promise<void> {
  const other = await accountByName(db, username);
  await db.deleteFrom('galaxy.blocks').where('blocker', '=', me).where('blocked', '=', other.id).execute();
}

/** Between me and `username`, for a profile's buttons (a block by them reads as none). */
export async function relationWith(db: Kysely<DB>, me: string, username: string): Promise<FriendRelation> {
  const other = await accountByName(db, username);
  if (other.id === me) return 'none';
  const blocks = await blockedBetween(db, me, other.id);
  if (blocks.mine) return 'blocked';
  if (blocks.theirs) return 'none';
  const [a, b] = pair(me, other.id);
  const row = await db.selectFrom('galaxy.friendships').select(['status', 'requested_by']).where('a', '=', a).where('b', '=', b).executeTakeFirst();
  if (!row) return 'none';
  if (row.status === 'accepted') return 'friends';
  return row.requested_by === me ? 'outgoing' : 'incoming';
}

/**
 * My friends (with their level, clan and presence as I may see it), the requests both ways, whom I blocked and my
 * preferences. `presenceOf` is the live hub's view (offline when it knows nothing).
 */
export async function friendsView(
  db: Kysely<DB>,
  cfgs: { social: SocialConfig; account: AccountConfig },
  me: string,
  presenceOf: (accountId: string) => Presence,
): Promise<FriendsView> {
  const rows = await db
    .selectFrom('galaxy.friendships as f')
    .innerJoin('galaxy.accounts as o', (j) => j.on(sql<boolean>`o.id = case when f.a = ${me}::uuid then f.b else f.a end`))
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'o.id')
    .leftJoin('galaxy.clan_members as m', 'm.account_id', 'o.id')
    .leftJoin('galaxy.clans as c', 'c.id', 'm.clan_id')
    .leftJoin('galaxy.social_prefs as p', 'p.account_id', 'o.id')
    .select(['o.id', 'o.username', 'o.avatar', 'o.frame', 'f.status', 'f.requested_by', 'f.created_at', 'f.accepted_at', 'x.xp', 'c.tag', 'p.show_status'])
    .where((eb) => eb.or([eb('f.a', '=', me), eb('f.b', '=', me)]))
    .orderBy('o.username')
    .execute();
  const blocked = await db
    .selectFrom('galaxy.blocks as k')
    .innerJoin('galaxy.accounts as o', 'o.id', 'k.blocked')
    .select(['o.username', 'k.created_at'])
    .where('k.blocker', '=', me)
    .orderBy('o.username')
    .execute();
  const level = (xp: unknown) => levelOf(Number(xp ?? 0), cfgs.account).level;
  const friends = rows
    .filter((r) => r.status === 'accepted')
    .map((r) => ({
      username: r.username,
      avatar: r.avatar,
      frame: r.frame,
      level: level(r.xp),
      clan: r.tag ?? null,
      presence: r.show_status === false ? ({ status: 'offline' } as const) : presenceOf(r.id),
      since: new Date(r.accepted_at ?? r.created_at).toISOString(),
    }))
    // Online first, then by name.
    .sort((x, y) => Number(y.presence.status === 'online') - Number(x.presence.status === 'online') || x.username.localeCompare(y.username));
  const pending = rows.filter((r) => r.status === 'pending');
  const entry = (r: (typeof rows)[number]) => ({ username: r.username, level: level(r.xp), at: new Date(r.created_at).toISOString() });
  return {
    friends,
    incoming: pending.filter((r) => r.requested_by !== me).map(entry),
    outgoing: pending.filter((r) => r.requested_by === me).map(entry),
    blocked: blocked.map((b) => ({ username: b.username, at: new Date(b.created_at).toISOString() })),
    prefs: await prefsOf(db, me),
    max: cfgs.social.maxFriends,
  };
}
