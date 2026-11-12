import { randomBytes } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import {
  ADMIN_CURRENCIES,
  ADMIN_PLAYERS_PAGE,
  type AdminCurrency,
  type AdminGalaxyGrant,
  type AdminPlayer,
  type AdminPlayerList,
  type AdminPlayerQuery,
  type AdminSection,
  type AdminSectionName,
  type AdminWallet,
  generateGalaxy,
  levelOf,
  type Role,
  TIERS,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import { revokeAllSessions } from '../auth/sessions';
import { hashPassword, verifyPassword } from '../auth/password';
import { lockClan, removeMember } from '../clans/service';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { credit, debit } from '../economy/wallet';
import { releaseHolds } from '../market/escrow';
import { HttpError } from '../errors';
import { hitRateLimit, RateLimitedError } from '../ratelimit';
import { invalidateLeaderboard } from '../social/leaderboard';
import { accountXp } from '../social/progress';
import { playerShopRows } from '../shop/admin';

// The admin panel's players (GDD §16.2; M6a). Everything about a player, and what an admin may change: currency (as
// compensating ledger entries), galaxies (granted or revoked, never deleted), experience, name, sessions, bans and the
// leaderboard. Each change commits with its audit row; the destructive ones ask for the admin's password first.

export type AdminDeps = { db: Kysely<DB>; config: ConfigReader };
const PAGE = 25;
const FOREVER = new Date('9999-12-31T00:00:00.000Z');
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * The acting admin's own password, checked. Past ten wrong ones in ten minutes every session of that admin closes, so
 * whoever is guessing from an unattended session has to pass TOTP again (M6a review).
 */
export async function confirmPassword(db: Kysely<DB>, s: SessionInfo, password: string | undefined): Promise<void> {
  const row = await db.selectFrom('galaxy.accounts').select('password_hash').where('id', '=', s.accountId).executeTakeFirstOrThrow();
  if (password !== undefined && (await verifyPassword(row.password_hash, password))) return;
  try {
    await hitRateLimit(db, `a:${s.accountId}`, 'admin_password', 10, 600);
  } catch (err) {
    if (err instanceof RateLimitedError) await revokeAllSessions(db, s.accountId);
    throw err;
  }
  throw new HttpError(401, 'password_wrong');
}

/**
 * Who an admin may act on (M6a review): nobody acts on a superadmin from the panel (only the container CLI does), only a
 * superadmin acts on other staff, and nobody changes their own account here (no gifts or bans to oneself).
 */
export async function guardTarget(db: Kysely<DB>, s: SessionInfo, username: string, opts: { self: boolean }): Promise<{ id: string }> {
  const a = await accountOf(db, username);
  const roles = (await rolesOf(db, [a.id])).get(a.id) ?? [];
  if (!opts.self && a.id === s.accountId) throw new HttpError(403, 'self_target');
  if (roles.includes('superadmin') || (roles.length > 0 && !s.roles.includes('superadmin'))) throw new HttpError(403, 'staff_target');
  return { id: a.id };
}

async function accountOf(db: Kysely<DB>, username: string): Promise<{ id: string; username: string }> {
  const a = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where(sql<string>`lower(username)`, '=', username.toLowerCase()).executeTakeFirst();
  if (!a) throw new HttpError(404, 'player_not_found');
  return a;
}

async function rolesOf(db: Kysely<DB>, ids: string[]): Promise<Map<string, Role[]>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('galaxy.account_roles').select(['account_id', 'role']).where('account_id', 'in', ids).execute();
  const out = new Map<string, Role[]>();
  for (const r of rows) out.set(r.account_id, [...(out.get(r.account_id) ?? []), r.role as Role]);
  return out;
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`).toLowerCase();
const looksLikeIp = (q: string) => /^[0-9a-f.:]+$/i.test(q) && /[.:]/.test(q);

/**
 * Every player, 50 a page (plan «escáner pro», part F; the owner: «lista completa, con paginador, filtrado y busqueda
 * profesional de usuarios»). Nothing typed lists everyone; a text finds names that contain it (those that start with it
 * first), an IP the accounts that signed in from it, a clan's tag its members. Deleted accounts only show when asked.
 */
export async function listPlayers(deps: AdminDeps & { online: () => Iterable<string> }, q: AdminPlayerQuery): Promise<AdminPlayerList> {
  const account = await deps.config.get('account');
  const online = new Set(deps.online());
  const where = [q.state === 'deleted' ? sql`a.deleted_at is not null` : sql`a.deleted_at is null`];
  if (q.state === 'online') {
    if (online.size === 0) return { players: [], total: 0, page: q.page, pages: 1 };
    where.push(sql`a.id = any(${[...online]}::uuid[])`);
  }
  if (q.state === 'active') where.push(sql`exists (select 1 from galaxy.sessions s where s.account_id = a.id and s.last_seen_at > now() - interval '7 days')`);
  if (q.state === 'banned') where.push(sql`a.banned_until is not null and a.banned_until > now()`);
  if (q.state === 'muted') where.push(sql`exists (select 1 from galaxy.chat_mutes m where m.account_id = a.id and m.until > now())`);
  if (q.state === 'staff') where.push(sql`exists (select 1 from galaxy.account_roles r where r.account_id = a.id)`);
  const text = q.q;
  if (text) {
    const like = `%${escapeLike(text)}%`;
    const found = [sql`lower(a.username) like ${like}`, sql`a.id in (select m.account_id from galaxy.clan_members m join galaxy.clans c on c.id = m.clan_id where c.tag = ${text.toUpperCase()})`];
    if (looksLikeIp(text)) found.push(sql`a.id in (select i.account_id from galaxy.account_ips i where i.ip = ${text})`);
    where.push(sql`(${sql.join(found, sql` or `)})`);
  }
  const cond = sql.join(where, sql` and `);
  const total = (await sql<{ n: number }>`select count(*)::int as n from galaxy.accounts a where ${cond}`.execute(deps.db)).rows[0]!.n;
  const dir = sql.raw(q.dir === 'asc' ? 'asc' : 'desc');
  const key = {
    created: sql`a.created_at ${dir}`,
    name: sql`lower(a.username) ${dir}`,
    seen: sql`last_seen ${dir} nulls last`,
    level: sql`coalesce(x.xp, 0) ${dir}`,
  }[q.sort];
  const order = text ? sql`(lower(a.username) like ${`${escapeLike(text)}%`}) desc, ${key}, a.id` : sql`${key}, a.id`;
  const rows = (
    await sql<{ id: string; username: string; created_at: Date; xp: string | number | null; tag: string | null; banned: boolean; muted: boolean; deleted_at: Date | null; last_seen: Date | null }>`
      select a.id, a.username, a.created_at, x.xp, c.tag, a.deleted_at,
        (a.banned_until is not null and a.banned_until > now()) as banned,
        exists (select 1 from galaxy.chat_mutes m where m.account_id = a.id and m.until > now()) as muted,
        (select max(s.last_seen_at) from galaxy.sessions s where s.account_id = a.id) as last_seen
      from galaxy.accounts a
      left join galaxy.account_xp x on x.account_id = a.id
      left join galaxy.clan_members cm on cm.account_id = a.id
      left join galaxy.clans c on c.id = cm.clan_id
      where ${cond}
      order by ${order}
      limit ${ADMIN_PLAYERS_PAGE} offset ${(q.page - 1) * ADMIN_PLAYERS_PAGE}`.execute(deps.db)
  ).rows;
  const roles = await rolesOf(deps.db, rows.map((r) => r.id));
  return {
    players: rows.map((r) => ({
      username: r.username,
      level: levelOf(Number(r.xp ?? 0), account).level,
      createdAt: iso(r.created_at)!,
      lastSeen: iso(r.last_seen),
      banned: r.banned,
      roles: roles.get(r.id) ?? [],
      clan: r.tag ?? null,
      online: online.has(r.id),
      muted: r.muted,
      deletedAt: iso(r.deleted_at),
    })),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / ADMIN_PLAYERS_PAGE)),
  };
}

const count = async (db: Kysely<DB>, table: 'galaxy.runs' | 'galaxy.gacha_pulls' | 'galaxy.chat_messages', column: 'account_id' | 'author_id', id: string) =>
  (await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}`.execute(db)).rows[0]!;

export async function playerDetail(deps: AdminDeps, username: string): Promise<AdminPlayer> {
  const { db } = deps;
  const a = await accountOf(db, username);
  const account = await deps.config.get('account');
  const [row, xp, balances, roles, mute, clan, sessions, ips, station, lab, probes] = await Promise.all([
    db.selectFrom('galaxy.accounts').select(['created_at', 'banned_until', 'leaderboard_excluded', 'deleted_at']).where('id', '=', a.id).executeTakeFirstOrThrow(),
    accountXp(db, a.id),
    db.selectFrom('galaxy.balances').select(['currency', 'amount']).where('account_id', '=', a.id).execute(),
    rolesOf(db, [a.id]),
    db.selectFrom('galaxy.chat_mutes').select(['until', 'reason']).where('account_id', '=', a.id).where('until', '>', sql<Date>`now()`).executeTakeFirst(),
    db
      .selectFrom('galaxy.clan_members as m')
      .innerJoin('galaxy.clans as c', 'c.id', 'm.clan_id')
      .select(['c.tag', 'c.name', 'm.role'])
      .where('m.account_id', '=', a.id)
      .executeTakeFirst(),
    db.selectFrom('galaxy.sessions').select(['created_at', 'expires_at', 'ip', 'user_agent', 'mfa']).where('account_id', '=', a.id).where('expires_at', '>', sql<Date>`now()`).orderBy('created_at', 'desc').limit(20).execute(),
    db.selectFrom('galaxy.account_ips').select(['ip', 'first_seen', 'last_seen']).where('account_id', '=', a.id).orderBy('last_seen', 'desc').limit(30).execute(),
    db.selectFrom('galaxy.station_rooms').select(['room', 'level']).where('account_id', '=', a.id).orderBy('room').execute(),
    db.selectFrom('galaxy.lab_nodes').select(['node', 'level']).where('account_id', '=', a.id).orderBy('node').execute(),
    db.selectFrom('galaxy.probe_levels').select(['probe', 'level']).where('account_id', '=', a.id).orderBy('probe').execute(),
  ]);
  const [galaxies, runs, pulls, messages, listings, trades] = await Promise.all([
    db.selectFrom('galaxy.galaxies').select(sql<number>`count(*)::int`.as('n')).where('owner_id', '=', a.id).where('disintegrated_at', 'is', null).executeTakeFirstOrThrow(),
    count(db, 'galaxy.runs', 'account_id', a.id),
    count(db, 'galaxy.gacha_pulls', 'account_id', a.id),
    count(db, 'galaxy.chat_messages', 'author_id', a.id),
    db.selectFrom('galaxy.market_listings').select(sql<number>`count(*)::int`.as('n')).where((eb) => eb.or([eb('seller_id', '=', a.id), eb('buyer_id', '=', a.id)])).executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.trades').select(sql<number>`count(*)::int`.as('n')).where((eb) => eb.or([eb('a_id', '=', a.id), eb('b_id', '=', a.id)])).executeTakeFirstOrThrow(),
  ]);
  const wallet = Object.fromEntries(ADMIN_CURRENCIES.map((c) => [c, 0])) as Record<AdminCurrency, number>;
  for (const b of balances) if ((ADMIN_CURRENCIES as readonly string[]).includes(b.currency)) wallet[b.currency as AdminCurrency] = Number(b.amount);
  const until = row.banned_until ? new Date(row.banned_until) : null;
  return {
    id: a.id,
    username: a.username,
    createdAt: iso(row.created_at)!,
    deletedAt: iso(row.deleted_at),
    roles: roles.get(a.id) ?? [],
    level: levelOf(xp, account).level,
    xp,
    banned: until && until > new Date() ? { until: until.toISOString(), permanent: until.getUTCFullYear() >= 9999 } : null,
    muted: mute ? { until: iso(mute.until)!, reason: mute.reason } : null,
    leaderboardExcluded: row.leaderboard_excluded,
    clan: clan ? { tag: clan.tag, name: clan.name, role: clan.role } : null,
    wallet,
    counts: { galaxies: galaxies.n, runs: runs.n, pulls: pulls.n, listings: listings.n, trades: trades.n, messages: messages.n },
    sessions: sessions.map((s) => ({ createdAt: iso(s.created_at)!, expiresAt: iso(s.expires_at)!, ip: s.ip, userAgent: s.user_agent, mfa: s.mfa })),
    ips: ips.map((i) => ({ ip: i.ip, firstSeen: iso(i.first_seen)!, lastSeen: iso(i.last_seen)! })),
    station: station.map((r) => ({ room: r.room, level: r.level })),
    lab: lab.map((n) => `${n.node}:${n.level}`),
    probes: probes.map((p) => ({ probe: p.probe, level: p.level })),
  };
}

/** A page of one of a player's histories, newest first. */
export async function playerSection(deps: AdminDeps, username: string, name: AdminSectionName, page: number): Promise<AdminSection> {
  const { db } = deps;
  const a = await accountOf(db, username);
  const off = (page - 1) * PAGE;
  const pages = (n: number) => Math.max(1, Math.ceil(n / PAGE));
  if (name === 'galaxies') {
    const total = await db.selectFrom('galaxy.galaxies').select(sql<number>`count(*)::int`.as('n')).where('owner_id', '=', a.id).executeTakeFirstOrThrow();
    const rows = await db
      .selectFrom('galaxy.galaxies')
      .select(['id', 'name', 'designation', 'tier', 'finish', 'level', 'origin', 'created_at', 'disintegrated_at'])
      .where('owner_id', '=', a.id)
      .orderBy('created_at', 'desc')
      .limit(PAGE)
      .offset(off)
      .execute();
    return {
      rows: rows.map((r) => ({ id: r.id, name: r.name, designation: r.designation, tier: TIERS[r.tier]!, finish: r.finish, level: r.level, origin: r.origin, at: iso(r.created_at), gone: r.disintegrated_at !== null })),
      page,
      pages: pages(total.n),
    };
  }
  if (name === 'ledger') {
    const total = await db.selectFrom('galaxy.ledger').select(sql<number>`count(*)::int`.as('n')).where('account_id', '=', a.id).executeTakeFirstOrThrow();
    const rows = await db.selectFrom('galaxy.ledger').select(['created_at', 'currency', 'delta', 'balance_after', 'reason']).where('account_id', '=', a.id).orderBy('id', 'desc').limit(PAGE).offset(off).execute();
    return { rows: rows.map((r) => ({ at: iso(r.created_at), currency: r.currency, delta: Number(r.delta), balance: Number(r.balance_after), reason: r.reason })), page, pages: pages(total.n) };
  }
  if (name === 'pulls') {
    const total = await count(db, 'galaxy.gacha_pulls', 'account_id', a.id);
    const rows = await db.selectFrom('galaxy.gacha_pulls').select(['created_at', 'banner', 'tier', 'finish', 'seed', 'galaxy_id']).where('account_id', '=', a.id).orderBy('created_at', 'desc').limit(PAGE).offset(off).execute();
    return { rows: rows.map((r) => ({ at: iso(r.created_at), banner: r.banner, tier: TIERS[r.tier]!, finish: r.finish, seed: String(r.seed), galaxy: r.galaxy_id })), page, pages: pages(total.n) };
  }
  if (name === 'runs') {
    const total = await count(db, 'galaxy.runs', 'account_id', a.id);
    const rows = await db
      .selectFrom('galaxy.runs')
      .select(['id', 'started_at', 'sector', 'probe', 'outcome', 'seconds', 'depth', 'kills', 'suspicious', 'flags'])
      .where('account_id', '=', a.id)
      .orderBy('started_at', 'desc')
      .limit(PAGE)
      .offset(off)
      .execute();
    return {
      rows: rows.map((r) => ({ id: r.id, at: iso(r.started_at), sector: r.sector, probe: r.probe, outcome: r.outcome ?? null, seconds: r.seconds ?? null, depth: r.depth ?? null, kills: r.kills ?? null, suspicious: r.suspicious, flags: r.flags.join(' ') })),
      page,
      pages: pages(total.n),
    };
  }
  if (name === 'market') {
    const [listings, trades] = await Promise.all([
      db
        .selectFrom('galaxy.market_listings as m')
        .innerJoin('galaxy.galaxies as g', 'g.id', 'm.galaxy_id')
        .select(['m.id', 'm.listed_at', 'm.status', 'm.price', 'm.seller_id', 'g.name'])
        .where((eb) => eb.or([eb('m.seller_id', '=', a.id), eb('m.buyer_id', '=', a.id)]))
        .orderBy('m.listed_at', 'desc')
        .limit(200)
        .execute(),
      db
        .selectFrom('galaxy.trades as t')
        .select(['t.id', 't.created_at', 't.status', 't.a_id', 't.b_id'])
        .where((eb) => eb.or([eb('t.a_id', '=', a.id), eb('t.b_id', '=', a.id)]))
        .orderBy('t.created_at', 'desc')
        .limit(200)
        .execute(),
    ]);
    const all = [
      ...listings.map((l) => ({ kind: l.seller_id === a.id ? 'venta' : 'compra', id: l.id, at: iso(l.listed_at), status: l.status, detail: `${l.name} ${Number(l.price)}` })),
      ...trades.map((t) => ({ kind: 'trueque', id: t.id, at: iso(t.created_at), status: t.status, detail: t.a_id === a.id ? 'propuesto' : 'recibido' })),
    ].sort((x, y) => (x.at! < y.at! ? 1 : -1));
    return { rows: all.slice(off, off + PAGE), page, pages: pages(all.length) };
  }
  if (name === 'shop') {
    // Shop and lab plan F4: the player's purchases of the resource shop, and its block first when there is one.
    const { rows, total } = await playerShopRows(db, a.id, page);
    return { rows, page, pages: pages(total) };
  }
  if (name === 'social') {
    // Plan phase 3: friends, requests both ways and blocks both ways (who blocked whom).
    const friends = await db
      .selectFrom('galaxy.friendships as f')
      .innerJoin('galaxy.accounts as o', (j) => j.on(sql<boolean>`o.id = case when f.a = ${a.id}::uuid then f.b else f.a end`))
      .select(['o.username', 'f.status', 'f.requested_by', 'f.created_at', 'f.accepted_at'])
      .where((eb) => eb.or([eb('f.a', '=', a.id), eb('f.b', '=', a.id)]))
      .execute();
    const blocks = await db
      .selectFrom('galaxy.blocks as k')
      .innerJoin('galaxy.accounts as x', 'x.id', 'k.blocker')
      .innerJoin('galaxy.accounts as y', 'y.id', 'k.blocked')
      .select(['x.username as blocker', 'y.username as blocked', 'k.created_at', 'k.blocker as blockerId'])
      .where((eb) => eb.or([eb('k.blocker', '=', a.id), eb('k.blocked', '=', a.id)]))
      .execute();
    const all = [
      ...friends.map((f) => ({
        id: `f:${f.username}`,
        at: iso(f.accepted_at ?? f.created_at),
        kind: f.status === 'accepted' ? 'friend' : f.requested_by === a.id ? 'request_out' : 'request_in',
        username: f.username,
      })),
      ...blocks.map((b) => ({
        id: `b:${b.blocker}:${b.blocked}`,
        at: iso(b.created_at),
        kind: b.blockerId === a.id ? 'blocks' : 'blocked_by',
        username: b.blockerId === a.id ? b.blocked : b.blocker,
      })),
    ].sort((x, y) => String(y.at).localeCompare(String(x.at)));
    return { rows: all.slice(off, off + PAGE), page, pages: pages(all.length) };
  }
  const total = await count(db, 'galaxy.chat_messages', 'author_id', a.id);
  const rows = await db.selectFrom('galaxy.chat_messages').select(['id', 'created_at', 'channel', 'body', 'hidden_at']).where('author_id', '=', a.id).orderBy('id', 'desc').limit(PAGE).offset(off).execute();
  return { rows: rows.map((r) => ({ id: String(r.id), at: iso(r.created_at), channel: r.channel, body: r.body, hidden: r.hidden_at !== null })), page, pages: pages(total.n) };
}

const target = (id: string) => ({ targetType: 'account', targetId: id });

export async function changeWallet(deps: AdminDeps, actor: AuditActor, username: string, req: AdminWallet): Promise<{ balance: number }> {
  const a = await accountOf(deps.db, username);
  return inTransaction(deps.db, async (trx) => {
    const before = await trx.selectFrom('galaxy.balances').select('amount').where('account_id', '=', a.id).where('currency', '=', req.currency).executeTakeFirst();
    const ref = { by: actor.label };
    const balance =
      req.amount > 0
        ? await credit(trx, a.id, req.currency, req.amount, 'admin_grant', ref)
        : await debit(trx, a.id, req.currency, -req.amount, 'admin_take', ref);
    await writeAudit(trx, { actor, action: 'player.wallet', ...target(a.id), before: { currency: req.currency, balance: Number(before?.amount ?? 0) }, after: { currency: req.currency, balance, amount: req.amount }, reason: req.reason });
    return { balance };
  });
}

export async function grantGalaxy(deps: AdminDeps, actor: AuditActor, username: string, req: AdminGalaxyGrant): Promise<{ id: string }> {
  const a = await accountOf(deps.db, username);
  const seed = req.seed ? BigInt(req.seed) : randomBytes(8).readBigUInt64BE() >> 1n;
  const tier = TIERS.indexOf(req.tier);
  // A chosen type (M6d-4): candidates from the seed are tried until one of that type falls in the tier, as a
  // featured pull does.
  let g: ReturnType<typeof generateGalaxy>;
  try {
    g = generateGalaxy(seed, tier, req.type ? { trait: 'galaxy_type', value: req.type } : undefined);
  } catch {
    throw new HttpError(409, 'galaxy_type_not_found');
  }
  return inTransaction(deps.db, async (trx) => {
    const row = await trx
      .insertInto('galaxy.galaxies')
      .values({ owner_id: a.id, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier, score: g.score, finish: req.finish, origin: 'grant' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, { actor, action: 'player.galaxy_grant', ...target(a.id), after: { galaxy: row.id, name: g.name, tier: req.tier, finish: req.finish, type: g.traits.galaxy_type, seed: g.seed.toString() }, reason: req.reason });
    return { id: row.id };
  });
}

/** Takes a galaxy away: out of the loadout, the planetarium, the market and any open trade, then marked gone. */
export async function revokeGalaxy(deps: AdminDeps, actor: AuditActor, username: string, galaxyId: string, reason: string): Promise<{ revoked: true }> {
  const a = await accountOf(deps.db, username);
  return inTransaction(deps.db, async (trx) => {
    const g = await trx.selectFrom('galaxy.galaxies').select(['id', 'name']).where('id', '=', galaxyId).where('owner_id', '=', a.id).where('disintegrated_at', 'is', null).forUpdate().executeTakeFirst();
    if (!g) throw new HttpError(404, 'galaxy_not_found');
    const held = await releaseHolds(trx, g.id);
    await trx.updateTable('galaxy.galaxies').set({ disintegrated_at: sql<Date>`now()` }).where('id', '=', g.id).execute();
    await writeAudit(trx, { actor, action: 'player.galaxy_revoke', ...target(a.id), before: { galaxy: g.id, name: g.name, held }, reason });
    return { revoked: true };
  });
}

export async function setXp(deps: AdminDeps, actor: AuditActor, username: string, xp: number, reason: string): Promise<{ xp: number }> {
  const a = await accountOf(deps.db, username);
  return inTransaction(deps.db, async (trx) => {
    const before = await accountXp(trx, a.id);
    await trx.insertInto('galaxy.account_xp').values({ account_id: a.id, xp }).onConflict((oc) => oc.column('account_id').doUpdateSet({ xp })).execute();
    await writeAudit(trx, { actor, action: 'player.xp', ...target(a.id), before: { xp: before }, after: { xp }, reason });
    return { xp };
  });
}

export async function renamePlayer(deps: AdminDeps, actor: AuditActor, username: string, next: string, reason: string): Promise<{ username: string }> {
  const a = await accountOf(deps.db, username);
  return inTransaction(deps.db, async (trx) => {
    const taken = await trx.selectFrom('galaxy.accounts').select('id').where(sql<string>`lower(username)`, '=', next.toLowerCase()).where('id', '!=', a.id).executeTakeFirst();
    const reserved = await trx.selectFrom('galaxy.reserved_usernames').select('username').where(sql<string>`lower(username)`, '=', next.toLowerCase()).executeTakeFirst();
    if (taken || reserved) throw new HttpError(409, 'username_taken');
    await trx.updateTable('galaxy.accounts').set({ username: next }).where('id', '=', a.id).execute();
    await writeAudit(trx, { actor, action: 'player.rename', ...target(a.id), before: { username: a.username }, after: { username: next }, reason });
    return { username: next };
  });
}

export async function closeSessions(deps: AdminDeps, actor: AuditActor, username: string, reason: string): Promise<{ closed: true }> {
  const a = await accountOf(deps.db, username);
  await inTransaction(deps.db, async (trx) => {
    await revokeAllSessions(trx, a.id);
    await writeAudit(trx, { actor, action: 'player.sessions_close', ...target(a.id), reason });
  });
  return { closed: true };
}

/** A ban closes the sessions and ends the player's listings and open trades (GDD §16.2); null minutes is for good. */
export async function banPlayer(deps: AdminDeps, actor: AuditActor, username: string, minutes: number | null, reason: string): Promise<{ until: string }> {
  const a = await accountOf(deps.db, username);
  return inTransaction(deps.db, async (trx) => {
    const until = minutes === null ? FOREVER : (await sql<{ t: Date }>`select now() + make_interval(mins => ${minutes}) as t`.execute(trx)).rows[0]!.t;
    await trx.updateTable('galaxy.accounts').set({ banned_until: until, ban_reason: reason }).where('id', '=', a.id).execute();
    await revokeAllSessions(trx, a.id);
    const listings = await trx.updateTable('galaxy.market_listings').set({ status: 'cancelled' }).where('seller_id', '=', a.id).where('status', '=', 'active').executeTakeFirst();
    const trades = await trx
      .updateTable('galaxy.trades')
      .set({ status: 'cancelled', closed_at: sql<Date>`now()` })
      .where('status', '=', 'open')
      .where((eb) => eb.or([eb('a_id', '=', a.id), eb('b_id', '=', a.id)]))
      .executeTakeFirst();
    await writeAudit(trx, {
      actor,
      action: 'player.ban',
      ...target(a.id),
      after: { until: new Date(until).toISOString(), listingsCancelled: Number(listings.numUpdatedRows), tradesCancelled: Number(trades.numUpdatedRows) },
      reason,
    });
    invalidateLeaderboard();
    return { until: new Date(until).toISOString() };
  });
}

export async function unbanPlayer(deps: AdminDeps, actor: AuditActor, username: string, reason: string): Promise<{ unbanned: true }> {
  const a = await accountOf(deps.db, username);
  await inTransaction(deps.db, async (trx) => {
    const before = await trx.selectFrom('galaxy.accounts').select(['banned_until', 'ban_reason']).where('id', '=', a.id).executeTakeFirstOrThrow();
    await trx.updateTable('galaxy.accounts').set({ banned_until: null, ban_reason: null }).where('id', '=', a.id).execute();
    await writeAudit(trx, { actor, action: 'player.unban', ...target(a.id), before: { until: iso(before.banned_until), reason: before.ban_reason }, reason });
  });
  invalidateLeaderboard();
  return { unbanned: true };
}

export async function setLeaderboardExcluded(deps: AdminDeps, actor: AuditActor, username: string, excluded: boolean, reason: string): Promise<{ excluded: boolean }> {
  const a = await accountOf(deps.db, username);
  await inTransaction(deps.db, async (trx) => {
    await trx.updateTable('galaxy.accounts').set({ leaderboard_excluded: excluded }).where('id', '=', a.id).execute();
    await writeAudit(trx, { actor, action: 'player.leaderboard', ...target(a.id), after: { excluded }, reason });
  });
  invalidateLeaderboard();
  return { excluded };
}


/**
 * «Eliminar» (plan «escáner pro», part F; the owner chose «anonimizar y cerrar»). A full delete would break history
 * (the append-only ledger, runs and pulls, purchases kept by law, other players' sales and trades), so the account
 * stays as a placeholder: a new name nobody chose, a password nobody knows, banned for good and out of the rankings.
 * Its personal and social data go (sessions, IPs, roles, TOTP, friends, blocks, preferences, chat messages, loadout,
 * showcases, sky, clan requests); a leader's clan passes on (or dissolves when alone); its listings and open trades
 * end. The audit keeps the old name; the name is free again unless the admin reserves it.
 */
export async function deletePlayer(deps: AdminDeps, actor: AuditActor, username: string, req: { confirm: string; reason: string; reserveName: boolean }): Promise<{ id: string; username: string }> {
  const a = await accountOf(deps.db, username);
  if (req.confirm.toLowerCase() !== a.username.toLowerCase()) throw new HttpError(400, 'confirm_mismatch');
  const done = await inTransaction(deps.db, async (trx) => {
    const row = await trx.selectFrom('galaxy.accounts').select(['deleted_at']).where('id', '=', a.id).forUpdate().executeTakeFirstOrThrow();
    if (row.deleted_at) throw new HttpError(409, 'player_deleted');
    let anon = '';
    for (;;) {
      anon = `borrado_${randomBytes(4).toString('hex')}`;
      const taken = await trx.selectFrom('galaxy.accounts').select('id').where('username', '=', anon).executeTakeFirst();
      if (!taken) break;
    }
    const clan = await trx.selectFrom('galaxy.clan_members').select(['clan_id', 'role']).where('account_id', '=', a.id).executeTakeFirst();
    let clanOut: { dissolved: boolean; heir?: string } | null = null;
    if (clan) {
      await lockClan(trx, clan.clan_id);
      clanOut = await removeMember(trx, clan.clan_id, a.id, clan.role);
    }
    await trx
      .updateTable('galaxy.accounts')
      .set({
        username: anon,
        password_hash: await hashPassword(randomBytes(32).toString('base64url')),
        deleted_at: sql<Date>`now()`,
        banned_until: FOREVER,
        ban_reason: req.reason,
        leaderboard_excluded: true,
        title: null,
        frame: null,
        avatar: null,
        banner: null,
      })
      .where('id', '=', a.id)
      .execute();
    await revokeAllSessions(trx, a.id);
    // What the API may not delete itself (chat messages, IPs, TOTP, reserving the name) goes through the database's
    // own function, which only acts on an account marked deleted just above.
    await sql`select galaxy.erase_account(${a.id}::uuid, ${req.reserveName ? a.username : null}::text)`.execute(trx);
    await trx.deleteFrom('galaxy.account_roles').where('account_id', '=', a.id).execute();
    await trx.deleteFrom('galaxy.friendships').where((eb) => eb.or([eb('a', '=', a.id), eb('b', '=', a.id)])).execute();
    await trx.deleteFrom('galaxy.blocks').where((eb) => eb.or([eb('blocker', '=', a.id), eb('blocked', '=', a.id)])).execute();
    await trx.deleteFrom('galaxy.loadouts').where('account_id', '=', a.id).execute();
    await trx.deleteFrom('galaxy.exhibits').where('account_id', '=', a.id).execute();
    await trx.deleteFrom('galaxy.backdrops').where('account_id', '=', a.id).execute();
    await trx.deleteFrom('galaxy.clan_requests').where('account_id', '=', a.id).execute();
    const listings = await trx.updateTable('galaxy.market_listings').set({ status: 'cancelled' }).where('seller_id', '=', a.id).where('status', '=', 'active').executeTakeFirst();
    const trades = await trx
      .updateTable('galaxy.trades')
      .set({ status: 'cancelled', closed_at: sql<Date>`now()` })
      .where('status', '=', 'open')
      .where((eb) => eb.or([eb('a_id', '=', a.id), eb('b_id', '=', a.id)]))
      .executeTakeFirst();
    await writeAudit(trx, {
      actor,
      action: 'player.delete',
      ...target(a.id),
      before: { username: a.username },
      after: {
        username: anon,
        reserved: req.reserveName,
        clan: clanOut ? (clanOut.dissolved ? 'dissolved' : clanOut.heir ? 'passed' : 'left') : null,
        listingsCancelled: Number(listings.numUpdatedRows),
        tradesCancelled: Number(trades.numUpdatedRows),
      },
      reason: req.reason,
    });
    return { id: a.id, username: anon };
  });
  invalidateLeaderboard();
  return done;
}
