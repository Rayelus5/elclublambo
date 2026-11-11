import { randomBytes } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import {
  ADMIN_CURRENCIES,
  type AdminCurrency,
  type AdminGalaxyGrant,
  type AdminPlayer,
  type AdminPlayerList,
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
import { verifyPassword } from '../auth/password';
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

/** By name (prefix), by an IP it signed in from, or by its clan's tag: 20 at most. */
export async function searchPlayers(deps: AdminDeps, q: string): Promise<AdminPlayerList> {
  const account = await deps.config.get('account');
  const like = `${q.replace(/[\\%_]/g, (c) => `\\${c}`).toLowerCase()}%`;
  const ids = new Set<string>();
  if (/^[0-9a-f.:]+$/i.test(q) && /[.:]/.test(q)) {
    for (const r of await deps.db.selectFrom('galaxy.account_ips').select('account_id').where('ip', '=', q).limit(20).execute()) ids.add(r.account_id);
  }
  for (const r of await deps.db.selectFrom('galaxy.accounts').select('id').where(sql<string>`lower(username)`, 'like', like).orderBy('username').limit(20).execute()) ids.add(r.id);
  const clan = await deps.db.selectFrom('galaxy.clans').select('id').where('tag', '=', q.toUpperCase()).executeTakeFirst();
  if (clan) for (const r of await deps.db.selectFrom('galaxy.clan_members').select('account_id').where('clan_id', '=', clan.id).execute()) ids.add(r.account_id);
  const list = [...ids].slice(0, 20);
  if (list.length === 0) return { players: [] };
  const rows = await deps.db
    .selectFrom('galaxy.accounts as a')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'a.id')
    .leftJoin('galaxy.clan_members as cm', 'cm.account_id', 'a.id')
    .leftJoin('galaxy.clans as c', 'c.id', 'cm.clan_id')
    .select([
      'a.id',
      'a.username',
      'a.created_at',
      'x.xp',
      'c.tag',
      sql<boolean>`a.banned_until is not null and a.banned_until > now()`.as('banned'),
      sql<Date | null>`(select max(s.last_seen_at) from galaxy.sessions s where s.account_id = a.id)`.as('last_seen'),
    ])
    .where('a.id', 'in', list)
    .orderBy('a.username')
    .execute();
  const roles = await rolesOf(deps.db, list);
  return {
    players: rows.map((r) => ({
      username: r.username,
      level: levelOf(Number(r.xp ?? 0), account).level,
      createdAt: iso(r.created_at)!,
      lastSeen: iso(r.last_seen),
      banned: r.banned,
      roles: roles.get(r.id) ?? [],
      clan: r.tag ?? null,
    })),
  };
}

const count = async (db: Kysely<DB>, table: 'galaxy.runs' | 'galaxy.gacha_pulls' | 'galaxy.chat_messages', column: 'account_id' | 'author_id', id: string) =>
  (await sql<{ n: number }>`select count(*)::int as n from ${sql.table(table)} where ${sql.ref(column)} = ${id}`.execute(db)).rows[0]!;

export async function playerDetail(deps: AdminDeps, username: string): Promise<AdminPlayer> {
  const { db } = deps;
  const a = await accountOf(db, username);
  const account = await deps.config.get('account');
  const [row, xp, balances, roles, mute, clan, sessions, ips, station, lab, probes] = await Promise.all([
    db.selectFrom('galaxy.accounts').select(['created_at', 'banned_until', 'leaderboard_excluded']).where('id', '=', a.id).executeTakeFirstOrThrow(),
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

