import { type MyTrades, type PublicGalaxy, TIERS, type TradeOffer, type TradePropose, type TradeView } from '@galaxy/shared';
import { type Kysely, type Selectable, sql, type Updateable } from 'kysely';
import type { DB, TradesTable } from '../db/schema';
import { HttpError } from '../errors';
import { isEquipped, isExhibited, isListed, isTraded } from './escrow';
import { lockTrader, type MarketConfigs, type MarketDeps, marketConfigs, refuse, rulesFor, todayStart } from './service';

// Swaps (GDD §14.5, §14.7; M5c-2): one galaxy for one galaxy between two accounts. a_* proposed, b_* is the other side.
// A galaxy is held only when its owner offers it (*_offered): the proposer's from the start, the other's once its owner
// puts it or confirms it; what a side only asked for stays free. Every change bumps the version, clears both
// confirmations and confirms the side that made it (when both galaxies are there). The swap runs when both confirmed the
// same version. Locks: the trade row first, then the galaxies in id order; proposing takes the trader's market lock.

type Trade = Selectable<TradesTable>;
type Side = 'a' | 'b';
const DAY_MS = 86_400_000;
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');
const sideOf = (t: Trade, accountId: string): Side | null => (t.a_id === accountId ? 'a' : t.b_id === accountId ? 'b' : null);
const isOpen = (t: Trade, now: Date) => t.status === 'open' && new Date(t.expires_at) > now;
/** One side's columns, read. */
const sideOf2 = (t: Trade, s: Side) =>
  s === 'a' ? { id: t.a_id, galaxy: t.a_galaxy, offered: t.a_offered, confirmed: t.a_confirmed } : { id: t.b_id, galaxy: t.b_galaxy, offered: t.b_offered, confirmed: t.b_confirmed };
/** One side's columns, written. */
function sideSet(s: Side, v: { galaxy?: string | null; offered?: boolean; confirmed?: boolean }): Updateable<TradesTable> {
  if (s === 'a') return { ...(v.galaxy !== undefined ? { a_galaxy: v.galaxy } : {}), ...(v.offered !== undefined ? { a_offered: v.offered } : {}), ...(v.confirmed !== undefined ? { a_confirmed: v.confirmed } : {}) };
  return { ...(v.galaxy !== undefined ? { b_galaxy: v.galaxy } : {}), ...(v.offered !== undefined ? { b_offered: v.offered } : {}), ...(v.confirmed !== undefined ? { b_confirmed: v.confirmed } : {}) };
}

async function publicGalaxies(db: Kysely<DB>, ids: (string | null)[]): Promise<Map<string, PublicGalaxy>> {
  const wanted = ids.filter((x): x is string => x !== null);
  if (wanted.length === 0) return new Map();
  const rows = await db
    .selectFrom('galaxy.galaxies')
    .select(['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level'])
    .where('id', 'in', wanted)
    .execute();
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, seed: String(r.seed), tier: TIERS[r.tier]!, finish: r.finish as PublicGalaxy['finish'], traits: r.traits, name: r.name, designation: r.designation, featured: r.featured, level: r.level },
    ]),
  );
}

async function viewsOf(db: Kysely<DB>, accountId: string, trades: Trade[], now: Date): Promise<TradeView[]> {
  const galaxies = await publicGalaxies(db, trades.flatMap((t) => [t.a_galaxy, t.b_galaxy]));
  const ids = [...new Set(trades.flatMap((t) => [t.a_id, t.b_id]))];
  const names = ids.length ? await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', ids).execute() : [];
  const nameOf = new Map(names.map((n) => [n.id, n.username]));
  return trades.map((t) => {
    const me: Side = t.a_id === accountId ? 'a' : 'b';
    const them = other(me);
    const g = (s: Side) => {
      const id = s === 'a' ? t.a_galaxy : t.b_galaxy;
      return id ? (galaxies.get(id) ?? null) : null;
    };
    const status = t.status === 'open' && new Date(t.expires_at) <= now ? 'expired' : t.status;
    return {
      id: t.id,
      version: t.version,
      status,
      createdAt: new Date(t.created_at).toISOString(),
      expiresAt: new Date(t.expires_at).toISOString(),
      proposedByMe: me === 'a',
      me: { galaxy: g(me), confirmed: me === 'a' ? t.a_confirmed : t.b_confirmed },
      them: { username: nameOf.get(them === 'a' ? t.a_id : t.b_id) ?? '', galaxy: g(them), confirmed: them === 'a' ? t.a_confirmed : t.b_confirmed },
    };
  });
}

async function viewOf(db: Kysely<DB>, accountId: string, id: string, now: Date): Promise<TradeView> {
  const t = await db.selectFrom('galaxy.trades').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  return (await viewsOf(db, accountId, [t], now))[0]!;
}

/** Open trades (not expired) an account proposed ('a') or received ('b'), for the limits. */
async function openCount(db: Kysely<DB>, accountId: string, now: Date, as: Side): Promise<number> {
  const { n } = await db
    .selectFrom('galaxy.trades')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('status', '=', 'open')
    .where('expires_at', '>', now)
    .where(as === 'a' ? 'a_id' : 'b_id', '=', accountId)
    .executeTakeFirstOrThrow();
  return n;
}

async function proposalsToday(db: Kysely<DB>, accountId: string, now: Date): Promise<number> {
  const { n } = await db.selectFrom('galaxy.trades').select(sql<number>`count(*)::int`.as('n')).where('a_id', '=', accountId).where('created_at', '>=', todayStart(now)).executeTakeFirstOrThrow();
  return n;
}

/**
 * A galaxy its owner puts into a trade: locked, the owner's and alive, and not equipped, exhibited, listed or offered in
 * another open trade. Open trades of it that expired end first (they still hold the unique slot).
 */
async function holdable(trx: Kysely<DB>, galaxyId: string, ownerId: string, tradeId: string | null): Promise<void> {
  const g = await trx.selectFrom('galaxy.galaxies').select('id').where('id', '=', galaxyId).where('owner_id', '=', ownerId).where('disintegrated_at', 'is', null).forUpdate().executeTakeFirst();
  if (!g) throw new HttpError(404, 'galaxy_not_found');
  if (await isEquipped(trx, [galaxyId])) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, [galaxyId])) throw new HttpError(409, 'galaxy_exhibited');
  if (await isListed(trx, [galaxyId])) throw new HttpError(409, 'galaxy_listed');
  await trx
    .updateTable('galaxy.trades')
    .set({ status: 'expired', closed_at: sql<Date>`now()` })
    .where('status', '=', 'open')
    .where('expires_at', '<=', sql<Date>`now()`)
    .where((eb) => eb.or([eb('a_galaxy', '=', galaxyId), eb('b_galaxy', '=', galaxyId)]))
    .execute();
  if (await isTraded(trx, [galaxyId], tradeId)) throw new HttpError(409, 'galaxy_in_trade');
}

/** A galaxy one side asks of the other: the other's and alive (not held: its owner has not agreed yet). */
async function askable(db: Kysely<DB>, galaxyId: string, ownerId: string): Promise<void> {
  const g = await db.selectFrom('galaxy.galaxies').select('id').where('id', '=', galaxyId).where('owner_id', '=', ownerId).where('disintegrated_at', 'is', null).executeTakeFirst();
  if (!g) throw new HttpError(404, 'galaxy_not_found');
}

export async function myTrades(deps: MarketDeps, accountId: string): Promise<MyTrades> {
  const cfgs = await marketConfigs(deps);
  const now = deps.now();
  const rows = await deps.db
    .selectFrom('galaxy.trades')
    .selectAll()
    .where((eb) => eb.or([eb('a_id', '=', accountId), eb('b_id', '=', accountId)]))
    .orderBy('created_at', 'desc')
    .limit(60)
    .execute();
  const views = await viewsOf(deps.db, accountId, rows, now);
  const rules = await rulesFor(deps.db, accountId, cfgs, now);
  const open = await openCount(deps.db, accountId, now, 'a');
  const today = await proposalsToday(deps.db, accountId, now);
  return {
    open: views.filter((v) => v.status === 'open'),
    closed: views.filter((v) => v.status !== 'open').slice(0, 20),
    rules: { ...rules, openTrades: Math.max(0, cfgs.market.openTrades - open), tradesLeft: Math.max(0, cfgs.market.perDay.trades - today), tradeDays: cfgs.market.tradeDays },
  };
}

/** Proposes a swap (inside its operation): the gates, the limits, my galaxy in escrow and, if named, the one I want. */
export async function proposeTrade(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, req: TradePropose, now: Date): Promise<TradeView> {
  const target = await trx.selectFrom('galaxy.accounts').select('id').where('username', '=', req.username).executeTakeFirst();
  if (!target) throw new HttpError(404, 'profile_not_found');
  if (target.id === accountId) throw new HttpError(409, 'trade_self');
  // Both traders, in id order: their counts hold under concurrent proposals (M5c-2 review).
  for (const who of [accountId, target.id].sort()) await lockTrader(trx, who);
  refuse(await rulesFor(trx, accountId, cfgs, now));
  // One open trade per pair of accounts (an expired one still holds the pair's slot: it ends now).
  await trx
    .updateTable('galaxy.trades')
    .set({ status: 'expired', closed_at: sql<Date>`now()` })
    .where('status', '=', 'open')
    .where('expires_at', '<=', sql<Date>`now()`)
    .where((eb) => eb.or([eb.and([eb('a_id', '=', accountId), eb('b_id', '=', target.id)]), eb.and([eb('a_id', '=', target.id), eb('b_id', '=', accountId)])]))
    .execute();
  const between = await trx
    .selectFrom('galaxy.trades')
    .select('id')
    .where('status', '=', 'open')
    .where((eb) => eb.or([eb.and([eb('a_id', '=', accountId), eb('b_id', '=', target.id)]), eb.and([eb('a_id', '=', target.id), eb('b_id', '=', accountId)])]))
    .executeTakeFirst();
  if (between) throw new HttpError(409, 'trade_exists');
  // What I proposed counts against me; what someone receives, against them: proposals sent to me never stop mine.
  if ((await openCount(trx, accountId, now, 'a')) >= cfgs.market.openTrades) throw new HttpError(409, 'trade_limit');
  if ((await openCount(trx, target.id, now, 'b')) >= cfgs.market.openTrades) throw new HttpError(409, 'trade_limit_them');
  if ((await proposalsToday(trx, accountId, now)) >= cfgs.market.perDay.trades) throw new HttpError(429, 'trade_daily_cap');
  await holdable(trx, req.give, accountId, null);
  if (req.want) await askable(trx, req.want, target.id);
  const row = await trx
    .insertInto('galaxy.trades')
    .values({
      a_id: accountId,
      b_id: target.id,
      a_galaxy: req.give,
      a_offered: true,
      b_galaxy: req.want ?? null,
      a_confirmed: req.want !== undefined,
      created_at: now,
      expires_at: new Date(now.getTime() + cfgs.market.tradeDays * DAY_MS),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return viewOf(trx, accountId, row.id, now);
}

/** The trade, locked, with the caller's side; 409 trade_gone when it is not theirs or no longer open. */
async function lockOpen(trx: Kysely<DB>, accountId: string, id: string, now: Date): Promise<{ t: Trade; side: Side }> {
  const t = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  const side = t ? sideOf(t, accountId) : null;
  if (!t || !side) throw new HttpError(409, 'trade_gone');
  if (!isOpen(t, now)) {
    if (t.status === 'open') await trx.updateTable('galaxy.trades').set({ status: 'expired', closed_at: now }).where('id', '=', t.id).execute();
    throw new HttpError(409, 'trade_gone');
  }
  return { t, side };
}

/** Changes what I give and what I want of the other (naming the version I saw). */
export async function changeTrade(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, id: string, req: TradeOffer, now: Date): Promise<TradeView> {
  const { t, side } = await lockOpen(trx, accountId, id, now);
  if (req.version !== t.version) throw new HttpError(409, 'trade_changed');
  refuse(await rulesFor(trx, accountId, cfgs, now));
  const them = other(side);
  const now0 = sideOf2(t, side);
  const then0 = sideOf2(t, them);
  const mine = { galaxy: now0.galaxy, offered: now0.offered };
  const theirs = { galaxy: then0.galaxy, offered: then0.offered, owner: then0.id };
  let changed = false;
  if (req.give !== mine.galaxy || (req.give !== null && !mine.offered)) {
    if (req.give) await holdable(trx, req.give, accountId, t.id);
    changed = changed || req.give !== mine.galaxy;
    mine.galaxy = req.give;
    mine.offered = req.give !== null;
  }
  if (req.want !== theirs.galaxy) {
    if (req.want) await askable(trx, req.want, theirs.owner);
    theirs.galaxy = req.want;
    theirs.offered = false;
    changed = true;
  }
  const complete = mine.galaxy !== null && theirs.galaxy !== null;
  await trx
    .updateTable('galaxy.trades')
    .set({
      version: changed ? t.version + 1 : t.version,
      ...sideSet(side, { galaxy: mine.galaxy, offered: mine.offered, confirmed: complete && mine.offered }),
      ...sideSet(them, { galaxy: theirs.galaxy, offered: theirs.offered, confirmed: changed ? false : then0.confirmed }),
    })
    .where('id', '=', t.id)
    .execute();
  // Saving the deal as it stands, after the other side confirmed it, is accepting it.
  if (complete && mine.offered && !changed && then0.confirmed) await swap(trx, cfgs, t.id, now);
  return viewOf(trx, accountId, t.id, now);
}

/**
 * The swap of a trade both sides confirmed (its row locked by the caller): both sides still allowed, both galaxies still
 * theirs, alive and held by nothing else; the galaxies locked in id order; then they change hands and the trade is done.
 */
async function swap(trx: Kysely<DB>, cfgs: MarketConfigs, id: string, now: Date): Promise<void> {
  const t = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  if (!t.a_galaxy || !t.b_galaxy || !t.a_confirmed || !t.b_confirmed) return;
  const pair = [t.a_galaxy, t.b_galaxy].sort();
  await trx.selectFrom('galaxy.galaxies').select('id').where('id', 'in', pair).orderBy('id').forUpdate().execute();
  // The swap: both sides still allowed, both galaxies still theirs, alive and held by nothing else.
  const banned = await trx
    .selectFrom('galaxy.accounts')
    .select('id')
    .where('id', 'in', [t.a_id, t.b_id])
    .where('banned_until', '>', now)
    .executeTakeFirst();
  if (banned) throw new HttpError(409, 'trade_gone');
  const live = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'owner_id', 'tier'])
    .where('id', 'in', pair)
    .where('disintegrated_at', 'is', null)
    .execute();
  const owns = (g: string, owner: string) => live.some((x) => x.id === g && x.owner_id === owner);
  if (!owns(t.a_galaxy, t.a_id) || !owns(t.b_galaxy, t.b_id)) throw new HttpError(409, 'trade_gone');
  if (await isEquipped(trx, pair)) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, pair)) throw new HttpError(409, 'galaxy_exhibited');
  if (await isListed(trx, pair)) throw new HttpError(409, 'galaxy_listed');
  if (await isTraded(trx, pair, t.id)) throw new HttpError(409, 'galaxy_in_trade');
  await trx.updateTable('galaxy.galaxies').set({ owner_id: t.b_id }).where('id', '=', t.a_galaxy).execute();
  await trx.updateTable('galaxy.galaxies').set({ owner_id: t.a_id }).where('id', '=', t.b_galaxy).execute();
  await trx.updateTable('galaxy.trades').set({ status: 'done', closed_at: now }).where('id', '=', t.id).execute();
  const tierOf = (g: string) => live.find((x) => x.id === g)!.tier;
  await alertIfSuspicious(trx, cfgs, { trade: t.id, a: t.a_id, b: t.b_id, gap: Math.abs(tierOf(t.a_galaxy) - tierOf(t.b_galaxy)) }, now);
}

/** Confirms the version I saw; when the other side confirmed it too, the galaxies change hands. */
export async function confirmTrade(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, id: string, version: number, now: Date): Promise<TradeView> {
  const { t, side } = await lockOpen(trx, accountId, id, now);
  if (version !== t.version) throw new HttpError(409, 'trade_changed');
  refuse(await rulesFor(trx, accountId, cfgs, now));
  if (!t.a_galaxy || !t.b_galaxy) throw new HttpError(409, 'trade_incomplete');
  // Both galaxies locked in id order before anything else, so two swaps never wait on each other in a circle.
  const pair = [t.a_galaxy, t.b_galaxy].sort();
  await trx.selectFrom('galaxy.galaxies').select('id').where('id', 'in', pair).orderBy('id').forUpdate().execute();
  const me = sideOf2(t, side);
  if (!me.offered) await holdable(trx, me.galaxy!, accountId, t.id);
  if (!sideOf2(t, other(side)).confirmed) {
    await trx.updateTable('galaxy.trades').set(sideSet(side, { offered: true, confirmed: true })).where('id', '=', t.id).execute();
    return viewOf(trx, accountId, t.id, now);
  }
  await trx.updateTable('galaxy.trades').set(sideSet(side, { offered: true, confirmed: true })).where('id', '=', t.id).execute();
  await swap(trx, cfgs, t.id, now);
  return viewOf(trx, accountId, t.id, now);
}

export async function cancelTrade(deps: MarketDeps, accountId: string, id: string): Promise<TradeView> {
  const now = deps.now();
  return deps.db.transaction().execute(async (trx) => {
    const t = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!t || !sideOf(t, accountId) || t.status !== 'open') throw new HttpError(409, 'trade_gone');
    await trx.updateTable('galaxy.trades').set({ status: 'cancelled', closed_at: now }).where('id', '=', t.id).execute();
    return viewOf(trx, accountId, t.id, now);
  });
}

/** An alert for the admin (shown in M6): the two accounts shared an IP lately, or the rarities are far apart. */
async function alertIfSuspicious(trx: Kysely<DB>, cfgs: MarketConfigs, swap: { trade: string; a: string; b: string; gap: number }, now: Date): Promise<void> {
  const since = new Date(now.getTime() - cfgs.market.sharedIpDays * DAY_MS);
  const shared = await trx
    .selectFrom('galaxy.account_ips as x')
    .innerJoin('galaxy.account_ips as y', 'y.ip', 'x.ip')
    .select('x.ip')
    .where('x.account_id', '=', swap.a)
    .where('y.account_id', '=', swap.b)
    .where('x.last_seen', '>=', since)
    .where('y.last_seen', '>=', since)
    .limit(1)
    .executeTakeFirst();
  const alerts: { kind: 'shared_ip' | 'unbalanced'; details: Record<string, unknown> }[] = [];
  if (shared) alerts.push({ kind: 'shared_ip', details: { ip: shared.ip } });
  if (swap.gap >= cfgs.market.tradeAlertTierGap) alerts.push({ kind: 'unbalanced', details: { tierGap: swap.gap } });
  if (alerts.length === 0) return;
  await trx
    .insertInto('galaxy.trade_alerts')
    .values(alerts.map((x) => ({ kind: x.kind, trade_id: swap.trade, seller_id: swap.a, buyer_id: swap.b, details: JSON.stringify(x.details) })))
    .execute();
}
