import {
  type AccountConfig,
  type ClanAction,
  type ClanCard,
  type ClanList,
  type ClanColor,
  type ClanCreate,
  type ClanEdit,
  type ClanEmblem,
  type ClanMember,
  type ClanRole,
  type ClansConfig,
  type ClanView,
  canManage,
  levelOf,
  type MyClan,
  type SeasonConfig,
  seasonOpen,
  successor,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { debit } from '../economy/wallet';
import { HttpError } from '../errors';
import { clanRanking, ranking, type SocialDeps } from '../social/leaderboard';
import { accountXp } from '../social/progress';

// Clans (GDD §14.3; M5b-1). One clan per account; a clan never passes `clans.maxMembers` and always has one leader
// while it has members. Every change takes the clan's lock first and then the account's, in that order, so two people
// cannot take the last place at once and two clans cannot take the same account. Creating one is an idempotent
// operation that charges its cost; the rest move no currency.

export interface ClanConfigs {
  clans: ClansConfig;
  account: AccountConfig;
  season: SeasonConfig;
}

export async function clanConfigs(deps: SocialDeps): Promise<ClanConfigs> {
  const [clans, account, season] = await Promise.all([deps.config.get('clans'), deps.config.get('account'), deps.config.get('season')]);
  return { clans, account, season };
}

const lock = (trx: Kysely<DB>, key: string) => sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
const ROLE_ORDER: Record<ClanRole, number> = { leader: 0, officer: 1, member: 2 };

type ClanRowDb = { id: string; tag: string; name: string; description: string; emblem: string; color: string; open: boolean; created_at: Date };

async function clanByTag(db: Kysely<DB>, tag: string): Promise<ClanRowDb> {
  const c = await db.selectFrom('galaxy.clans').selectAll().where('tag', '=', tag).executeTakeFirst();
  if (!c) throw new HttpError(404, 'clan_not_found');
  return { ...c, created_at: new Date(c.created_at) };
}

async function membership(db: Kysely<DB>, accountId: string): Promise<{ clan_id: string; role: ClanRole; joined_at: Date } | undefined> {
  const m = await db.selectFrom('galaxy.clan_members').select(['clan_id', 'role', 'joined_at']).where('account_id', '=', accountId).executeTakeFirst();
  return m ? { clan_id: m.clan_id, role: m.role, joined_at: new Date(m.joined_at) } : undefined;
}

async function accountNamed(db: Kysely<DB>, username: string): Promise<string> {
  const a = await db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirst();
  if (!a) throw new HttpError(404, 'not_in_clan');
  return a.id;
}

async function memberCount(db: Kysely<DB>, clanId: string): Promise<number> {
  const r = await db.selectFrom('galaxy.clan_members').select(sql<number>`count(*)::int`.as('n')).where('clan_id', '=', clanId).executeTakeFirstOrThrow();
  return r.n;
}

/** A clan as anyone signed in sees it; its leader and officers also see who asked to join. */
export async function clanView(db: Kysely<DB>, clanId: string, viewerId: string, cfgs: ClanConfigs, now: Date): Promise<ClanView> {
  const c = await db.selectFrom('galaxy.clans').selectAll().where('id', '=', clanId).executeTakeFirst();
  if (!c) throw new HttpError(404, 'clan_not_found');
  const rows = await db
    .selectFrom('galaxy.clan_members as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.account_id')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'm.account_id')
    .select(['m.account_id', 'm.role', 'm.joined_at', 'a.username', 'x.xp'])
    .where('m.clan_id', '=', clanId)
    .execute();
  const points = seasonOpen(cfgs.season, now) ? new Map((await ranking(db, cfgs.season, 'general', cfgs.account.minRunSeconds)).map((r) => [r.accountId, r.value])) : new Map<string, number>();
  const members: ClanMember[] = rows
    .map((r) => ({
      username: r.username,
      role: r.role,
      level: levelOf(Number(r.xp ?? 0), cfgs.account).level,
      points: points.get(r.account_id) ?? 0,
      joinedAt: new Date(r.joined_at).toISOString(),
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
  const ranked = (await clanRanking(db, cfgs.season, cfgs.account, now)).find((x) => x.id === clanId);
  const mine = rows.find((r) => r.account_id === viewerId);
  const asked = mine ? undefined : await db.selectFrom('galaxy.clan_requests').select('account_id').where('clan_id', '=', clanId).where('account_id', '=', viewerId).executeTakeFirst();
  const view: ClanView = {
    tag: c.tag,
    name: c.name,
    description: c.description,
    emblem: c.emblem as ClanEmblem,
    color: c.color as ClanColor,
    open: c.open,
    createdAt: new Date(c.created_at).toISOString(),
    maxMembers: cfgs.clans.maxMembers,
    members,
    score: ranked?.value ?? 0,
    rank: ranked?.rank ?? null,
    me: mine ? { role: mine.role } : asked ? { requested: true } : null,
  };
  if (mine && (mine.role === 'leader' || mine.role === 'officer')) {
    const requests = await db
      .selectFrom('galaxy.clan_requests as q')
      .innerJoin('galaxy.accounts as a', 'a.id', 'q.account_id')
      .select('a.username')
      .where('q.clan_id', '=', clanId)
      .orderBy('q.created_at')
      .execute();
    view.requests = requests.map((r) => r.username);
  }
  return view;
}

export async function viewByTag(deps: SocialDeps, viewerId: string, tag: string): Promise<ClanView> {
  const c = await clanByTag(deps.db, tag);
  return clanView(deps.db, c.id, viewerId, await clanConfigs(deps), deps.now());
}

export async function myClan(deps: SocialDeps, viewerId: string): Promise<MyClan> {
  const m = await membership(deps.db, viewerId);
  return m ? clanView(deps.db, m.clan_id, viewerId, await clanConfigs(deps), deps.now()) : null;
}

/** Clans by score (up to 30), filtered by a piece of the name or the start of the tag. */
export async function listClans(deps: SocialDeps, q: string | undefined): Promise<ClanList> {
  const cfgs = await clanConfigs(deps);
  const needle = (q ?? '').trim().toLocaleLowerCase('es');
  const clans: ClanCard[] = (await clanRanking(deps.db, cfgs.season, cfgs.account, deps.now()))
    .filter((c) => !needle || c.name.toLocaleLowerCase('es').includes(needle) || c.tag.toLowerCase().startsWith(needle))
    .slice(0, 30)
    .map((c) => ({ tag: c.tag, name: c.name, emblem: c.emblem, color: c.color, open: c.open, members: c.members, maxMembers: cfgs.clans.maxMembers, score: c.value }));
  return { clans, rules: { maxMembers: cfgs.clans.maxMembers, createCost: { coins: cfgs.clans.createCost.coins }, minLevel: cfgs.clans.minLevel } };
}

/** Creating a clan: the level it needs, a free name and tag, its cost; the creator leads it. */
export async function createClan(trx: Kysely<DB>, accountId: string, req: ClanCreate, key: string, cfgs: ClanConfigs, now: Date): Promise<ClanView> {
  if (levelOf(await accountXp(trx, accountId), cfgs.account).level < cfgs.clans.minLevel) throw new HttpError(403, 'level_too_low');
  await lock(trx, `clan-account:${accountId}`);
  if (await membership(trx, accountId)) throw new HttpError(409, 'already_in_clan');
  const taken = await trx
    .selectFrom('galaxy.clans')
    .select(['name', 'tag'])
    .where((eb) => eb.or([eb(sql`lower(name)`, '=', req.name.toLowerCase()), eb('tag', '=', req.tag)]))
    .execute();
  if (taken.some((t) => t.name.toLowerCase() === req.name.toLowerCase())) throw new HttpError(409, 'clan_name_taken');
  if (taken.length > 0) throw new HttpError(409, 'clan_tag_taken');
  if (cfgs.clans.createCost.coins > 0) await debit(trx, accountId, 'coins', cfgs.clans.createCost.coins, 'clan_create', { tag: req.tag }, key);
  let id: string;
  try {
    ({ id } = await trx
      .insertInto('galaxy.clans')
      .values({ name: req.name, tag: req.tag, description: req.description, emblem: req.emblem, color: req.color, open: req.open })
      .returning('id')
      .executeTakeFirstOrThrow());
  } catch (e) {
    // Someone took the name or the tag in between.
    const constraint = (e as { constraint?: string }).constraint;
    if (constraint === 'clans_name_ci') throw new HttpError(409, 'clan_name_taken');
    if (constraint === 'clans_tag_key') throw new HttpError(409, 'clan_tag_taken');
    throw e;
  }
  await trx.insertInto('galaxy.clan_members').values({ account_id: accountId, clan_id: id, role: 'leader' }).execute();
  await trx.deleteFrom('galaxy.clan_requests').where('account_id', '=', accountId).execute();
  return clanView(trx, id, accountId, cfgs, now);
}

/** Puts an account in a clan, under both locks already taken: not in another, and with a place free. */
async function admit(trx: Kysely<DB>, clanId: string, accountId: string, cfgs: ClanConfigs): Promise<void> {
  if (await membership(trx, accountId)) throw new HttpError(409, 'already_in_clan');
  if ((await memberCount(trx, clanId)) >= cfgs.clans.maxMembers) throw new HttpError(409, 'clan_full');
  await trx.insertInto('galaxy.clan_members').values({ account_id: accountId, clan_id: clanId, role: 'member' }).execute();
  // Entering any clan drops the requests to the others.
  await trx.deleteFrom('galaxy.clan_requests').where('account_id', '=', accountId).execute();
}

export async function joinClan(deps: SocialDeps, accountId: string, tag: string, asRequest: boolean): Promise<ClanView> {
  const cfgs = await clanConfigs(deps);
  const c = await clanByTag(deps.db, tag);
  await inTransaction(deps.db, async (trx) => {
    await lock(trx, `clan:${c.id}`);
    await lock(trx, `clan-account:${accountId}`);
    if (c.open) return admit(trx, c.id, accountId, cfgs);
    if (!asRequest) throw new HttpError(409, 'clan_closed');
    if (await membership(trx, accountId)) throw new HttpError(409, 'already_in_clan');
    await trx.insertInto('galaxy.clan_requests').values({ clan_id: c.id, account_id: accountId }).onConflict((oc) => oc.columns(['clan_id', 'account_id']).doNothing()).execute();
  });
  return clanView(deps.db, c.id, accountId, cfgs, deps.now());
}

export async function cancelRequest(deps: SocialDeps, accountId: string, tag: string): Promise<ClanView> {
  const c = await clanByTag(deps.db, tag);
  const gone = await deps.db.deleteFrom('galaxy.clan_requests').where('clan_id', '=', c.id).where('account_id', '=', accountId).executeTakeFirst();
  if (Number(gone.numDeletedRows) === 0) throw new HttpError(404, 'request_not_found');
  return clanView(deps.db, c.id, accountId, await clanConfigs(deps), deps.now());
}

/** The actor's role in this clan (under its lock), or 403 when they are not in it. */
async function actorRole(trx: Kysely<DB>, clanId: string, actorId: string): Promise<ClanRole> {
  const m = await membership(trx, actorId);
  if (!m || m.clan_id !== clanId) throw new HttpError(403, 'clan_forbidden');
  return m.role;
}

export async function answerRequest(deps: SocialDeps, actorId: string, tag: string, username: string, accept: boolean): Promise<ClanView> {
  const cfgs = await clanConfigs(deps);
  const c = await clanByTag(deps.db, tag);
  await inTransaction(deps.db, async (trx) => {
    await lock(trx, `clan:${c.id}`);
    if (!canManage(await actorRole(trx, c.id, actorId), 'member', 'accept')) throw new HttpError(403, 'clan_forbidden');
    const target = await trx.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirst();
    const request = target && (await trx.selectFrom('galaxy.clan_requests').select('account_id').where('clan_id', '=', c.id).where('account_id', '=', target.id).executeTakeFirst());
    if (!target || !request) throw new HttpError(404, 'request_not_found');
    if (!accept) {
      await trx.deleteFrom('galaxy.clan_requests').where('clan_id', '=', c.id).where('account_id', '=', target.id).execute();
      return;
    }
    await lock(trx, `clan-account:${target.id}`);
    await admit(trx, c.id, target.id, cfgs);
  });
  return clanView(deps.db, c.id, actorId, cfgs, deps.now());
}

export async function manageMember(deps: SocialDeps, actorId: string, tag: string, username: string, action: Exclude<ClanAction, 'accept' | 'edit'>): Promise<ClanView> {
  const cfgs = await clanConfigs(deps);
  const c = await clanByTag(deps.db, tag);
  await inTransaction(deps.db, async (trx) => {
    await lock(trx, `clan:${c.id}`);
    const role = await actorRole(trx, c.id, actorId);
    const targetId = await accountNamed(trx, username);
    const target = await membership(trx, targetId);
    if (!target || target.clan_id !== c.id) throw new HttpError(404, 'not_in_clan');
    if (!canManage(role, target.role, action)) throw new HttpError(403, 'clan_forbidden');
    if (action === 'kick') await trx.deleteFrom('galaxy.clan_members').where('account_id', '=', targetId).execute();
    if (action === 'promote') await trx.updateTable('galaxy.clan_members').set({ role: 'officer' }).where('account_id', '=', targetId).execute();
    if (action === 'demote') await trx.updateTable('galaxy.clan_members').set({ role: 'member' }).where('account_id', '=', targetId).execute();
    if (action === 'transfer') {
      // One leader per clan: the leader steps down first.
      await trx.updateTable('galaxy.clan_members').set({ role: 'officer' }).where('account_id', '=', actorId).execute();
      await trx.updateTable('galaxy.clan_members').set({ role: 'leader' }).where('account_id', '=', targetId).execute();
    }
  });
  return clanView(deps.db, c.id, actorId, cfgs, deps.now());
}

/** Leaving: a leader's place goes to the oldest officer, else the oldest member; the last one out disbands the clan. */
export async function leaveClan(deps: SocialDeps, accountId: string, tag: string): Promise<MyClan> {
  const c = await clanByTag(deps.db, tag);
  await inTransaction(deps.db, async (trx) => {
    await lock(trx, `clan:${c.id}`);
    const me = await membership(trx, accountId);
    if (!me || me.clan_id !== c.id) throw new HttpError(409, 'not_in_clan');
    await trx.deleteFrom('galaxy.clan_members').where('account_id', '=', accountId).execute();
    if (me.role !== 'leader') return;
    const rest = await trx.selectFrom('galaxy.clan_members').select(['account_id', 'role', 'joined_at']).where('clan_id', '=', c.id).execute();
    const next = successor(rest.map((r) => ({ role: r.role, joinedAt: new Date(r.joined_at).toISOString() })));
    if (next === null) await trx.deleteFrom('galaxy.clans').where('id', '=', c.id).execute();
    else await trx.updateTable('galaxy.clan_members').set({ role: 'leader' }).where('account_id', '=', rest[next]!.account_id).execute();
  });
  return null;
}

export async function editClan(deps: SocialDeps, actorId: string, tag: string, req: ClanEdit): Promise<ClanView> {
  const cfgs = await clanConfigs(deps);
  const c = await clanByTag(deps.db, tag);
  await inTransaction(deps.db, async (trx) => {
    await lock(trx, `clan:${c.id}`);
    if (!canManage(await actorRole(trx, c.id, actorId), 'member', 'edit')) throw new HttpError(403, 'clan_forbidden');
    if (Object.keys(req).length > 0) await trx.updateTable('galaxy.clans').set(req).where('id', '=', c.id).execute();
  });
  return clanView(deps.db, c.id, actorId, cfgs, deps.now());
}
