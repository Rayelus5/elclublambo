import type { AdminClan, AdminClanEdit, AdminClanRow, ClanRole } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import { fold, lockClan, removeMember } from '../clans/service';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { confirmPassword, guardTarget } from './players';

// Clan moderation (GDD §16.1, §16.4; M6c-1), for admins only: finding a clan, its roster, renaming it, kicking a
// member, handing the lead over and dissolving it. Each change takes the clan's lock (as the clans' own changes do)
// and is audited against the clan in the same transaction.

export type AdminClanDeps = { db: Kysely<DB>; config: ConfigReader };

const iso = (d: Date | string) => new Date(d).toISOString();
const audit = (id: string) => ({ targetType: 'clan', targetId: id });

type ClanDb = { id: string; tag: string; name: string; description: string; emblem: string; color: string; open: boolean; created_at: Date };

async function clanByTag(db: Kysely<DB>, tag: string): Promise<ClanDb> {
  const c = await db.selectFrom('galaxy.clans').selectAll().where('tag', '=', tag).executeTakeFirst();
  if (!c) throw new HttpError(404, 'clan_not_found');
  return c;
}

/** The roster, in the order they joined. */
async function roster(db: Kysely<DB>, clanId: string): Promise<AdminClan['roster']> {
  const rows = await db
    .selectFrom('galaxy.clan_members as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.account_id')
    .select(['a.username', 'm.role', 'm.joined_at'])
    .where('m.clan_id', '=', clanId)
    .orderBy('m.joined_at')
    .orderBy('a.username')
    .execute();
  return rows.map((r) => ({ username: r.username, role: r.role as ClanRole, joinedAt: iso(r.joined_at) }));
}

/**
 * By the start of the tag or a piece of the name, accents and case aside (the clans' own search); with nothing to look
 * for, the newest. 20 at most. The beta has few clans, so they are filtered here.
 */
export async function adminClans(db: Kysely<DB>, q: string | undefined): Promise<AdminClanRow[]> {
  const needle = fold(q ?? '');
  const all = await db.selectFrom('galaxy.clans').select(['id', 'tag', 'name', 'created_at']).orderBy('created_at', 'desc').execute();
  const found = all.filter((c) => !needle || c.tag.toLowerCase().startsWith(needle) || fold(c.name).includes(needle)).slice(0, 20);
  if (found.length === 0) return [];
  const members = await db
    .selectFrom('galaxy.clan_members as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.account_id')
    .select(['m.clan_id', 'm.role', 'a.username'])
    .where(
      'm.clan_id',
      'in',
      found.map((c) => c.id),
    )
    .execute();
  return found.map((c) => {
    const mine = members.filter((m) => m.clan_id === c.id);
    return { tag: c.tag, name: c.name, members: mine.length, leader: mine.find((m) => m.role === 'leader')?.username ?? null, createdAt: iso(c.created_at) };
  });
}

export async function adminClan(db: Kysely<DB>, tag: string): Promise<AdminClan> {
  const c = await clanByTag(db, tag);
  const list = await roster(db, c.id);
  return {
    tag: c.tag,
    name: c.name,
    members: list.length,
    leader: list.find((m) => m.role === 'leader')?.username ?? null,
    createdAt: iso(c.created_at),
    description: c.description,
    emblem: c.emblem,
    color: c.color,
    open: c.open,
    roster: list,
  };
}

/** Renames a clan (name, tag, description: what is sent), audited with what it was and what it is. */
export async function adminEditClan(deps: AdminClanDeps, actor: AuditActor, tag: string, req: AdminClanEdit): Promise<AdminClan> {
  const { reason, ...fields } = req;
  const c = await clanByTag(deps.db, tag);
  const next = await inTransaction(deps.db, async (trx) => {
    await lockClan(trx, c.id);
    const now = await trx.selectFrom('galaxy.clans').select(['name', 'tag', 'description']).where('id', '=', c.id).executeTakeFirstOrThrow();
    const taken = await trx
      .selectFrom('galaxy.clans')
      .select(['name', 'tag'])
      .where('id', '!=', c.id)
      .where((eb) => eb.or([...(fields.name ? [eb(sql<string>`lower(name)`, '=', fields.name.toLowerCase())] : []), ...(fields.tag ? [eb('tag', '=', fields.tag)] : []), eb.val(false)]))
      .execute();
    if (fields.name && taken.some((t) => t.name.toLowerCase() === fields.name!.toLowerCase())) throw new HttpError(409, 'clan_name_taken');
    if (taken.length > 0) throw new HttpError(409, 'clan_tag_taken');
    try {
      await trx.updateTable('galaxy.clans').set(fields).where('id', '=', c.id).execute();
    } catch (e) {
      // Someone took the name or the tag in between.
      const constraint = (e as { constraint?: string }).constraint;
      if (constraint === 'clans_name_ci') throw new HttpError(409, 'clan_name_taken');
      if (constraint === 'clans_tag_key') throw new HttpError(409, 'clan_tag_taken');
      throw e;
    }
    const before = Object.fromEntries(Object.keys(fields).map((k) => [k, now[k as keyof typeof now]]));
    await writeAudit(trx, { actor, action: 'clan.edit', ...audit(c.id), before, after: fields, reason });
    return fields.tag ?? now.tag;
  });
  return adminClan(deps.db, next);
}

/** The member named, under the clan's lock; 409 when they are not in this clan. */
async function memberOf(trx: Kysely<DB>, clanId: string, username: string): Promise<{ id: string; role: ClanRole; username: string }> {
  const m = await trx
    .selectFrom('galaxy.clan_members as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.account_id')
    .select(['a.id', 'a.username', 'm.role'])
    .where('m.clan_id', '=', clanId)
    .where(sql<string>`lower(a.username)`, '=', username.toLowerCase())
    .executeTakeFirst();
  if (!m) throw new HttpError(409, 'not_in_clan');
  return { id: m.id, username: m.username, role: m.role as ClanRole };
}

/**
 * Kicks a member: the lead passes on if they led it, the last one out dissolves it, and they stay out for
 * `clans.kickHours` as with a leader's kick. Nobody kicks a superadmin, and only a superadmin kicks other staff.
 */
export async function adminKick(deps: AdminClanDeps, actor: AuditActor, s: SessionInfo, tag: string, username: string, reason: string): Promise<{ dissolved: boolean }> {
  const { kickHours } = await deps.config.get('clans');
  const c = await clanByTag(deps.db, tag);
  await guardTarget(deps.db, s, username, { self: true });
  return inTransaction(deps.db, async (trx) => {
    await lockClan(trx, c.id);
    const m = await memberOf(trx, c.id, username);
    const done = await removeMember(trx, c.id, m.id, m.role);
    if (!done.dissolved) {
      const until = sql<Date>`now() + make_interval(hours => ${kickHours}::int)`;
      await trx
        .insertInto('galaxy.clan_kicks')
        .values({ clan_id: c.id, account_id: m.id, until })
        .onConflict((oc) => oc.columns(['clan_id', 'account_id']).doUpdateSet({ until }))
        .execute();
    }
    await writeAudit(trx, { actor, action: 'clan.kick', ...audit(c.id), before: { username: m.username, role: m.role }, after: done, reason });
    return done;
  });
}

/** Hands the lead to a member; the leader steps down to officer (one leader per clan). */
export async function adminTransfer(deps: AdminClanDeps, actor: AuditActor, tag: string, username: string, reason: string): Promise<AdminClan> {
  const c = await clanByTag(deps.db, tag);
  await inTransaction(deps.db, async (trx) => {
    await lockClan(trx, c.id);
    const m = await memberOf(trx, c.id, username);
    if (m.role === 'leader') return;
    const leader = await trx
      .selectFrom('galaxy.clan_members as m')
      .innerJoin('galaxy.accounts as a', 'a.id', 'm.account_id')
      .select(['a.id', 'a.username'])
      .where('m.clan_id', '=', c.id)
      .where('m.role', '=', 'leader')
      .executeTakeFirst();
    if (leader) await trx.updateTable('galaxy.clan_members').set({ role: 'officer' }).where('account_id', '=', leader.id).execute();
    await trx.updateTable('galaxy.clan_members').set({ role: 'leader' }).where('account_id', '=', m.id).execute();
    await writeAudit(trx, { actor, action: 'clan.leader', ...audit(c.id), before: { leader: leader?.username ?? null }, after: { leader: m.username }, reason });
  });
  return adminClan(deps.db, tag);
}

/** Dissolves a clan with the admin's password: its members, requests and kicks go with it; its chat stays, unread. */
export async function adminDissolve(deps: AdminClanDeps, actor: AuditActor, s: SessionInfo, tag: string, reason: string, password: string): Promise<{ dissolved: true }> {
  const c = await clanByTag(deps.db, tag);
  await confirmPassword(deps.db, s, password);
  await inTransaction(deps.db, async (trx) => {
    await lockClan(trx, c.id);
    const members = (await roster(trx, c.id)).map((m) => m.username);
    await trx.deleteFrom('galaxy.clans').where('id', '=', c.id).execute();
    await writeAudit(trx, { actor, action: 'clan.dissolve', ...audit(c.id), before: { tag: c.tag, name: c.name, members }, reason });
  });
  return { dissolved: true };
}
