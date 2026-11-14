import {
  commissionOf,
  dealProblem,
  givesSomething,
  minPriceFor,
  type MyTrades,
  type PublicGalaxy,
  TIERS,
  type TradeDealInput,
  type TradeDealSide,
  type TradeEvent,
  type TradeOffer,
  type TradePropose,
  type TradeView,
} from '@galaxy/shared';
import { type ExpressionBuilder, type Kysely, type Selectable, sql, type Updateable } from 'kysely';
import type { DB, TradeEventDeal, TradesTable } from '../db/schema';
import { credit, debit } from '../economy/wallet';
import { HttpError } from '../errors';
import { type Notices, noticePlayer, withNotices } from '../realtime/notices';
import { blockedBetween, checkAnswer, closePost } from './board';
import { isEquipped, isExhibited, isListed, isTraded } from './escrow';
import { releaseHold } from './offers';
import { lockTrader, type MarketConfigs, type MarketDeps, marketConfigs, refuse, rulesFor, todayStart } from './service';

// Swaps (GDD §14.5, §14.7; M5c-2; trades 2.0, the owner, 2026-11-14): each side gives up to `market.tradeGalaxies`
// galaxies (`trade_items`) and, one side at most, coins. a_* proposed, b_* is the other side. What a side gives is held
// only when its owner offers it (*_offered): the proposer's from the start, the other's once its owner puts it or
// confirms it; what a side only asked for stays free. Offered coins are held like a market offer's (`coin_holds`).
// Every change bumps the version, clears both confirmations and confirms the side that made it (when both sides give
// something); every proposal, counter-offer, confirmation, swap and cancel is kept in `trade_events`. The swap runs when
// both confirmed the same version: the galaxies cross, the coins go to the other side less the market's commission.
// Whatever closes an open trade frees what it held, in the database (20261114150000_galaxy_trades_v2).
// Locks: the trade row first, then every galaxy involved in id order, then balances; proposing takes the traders' locks.

type Trade = Selectable<TradesTable>;
type Side = 'a' | 'b';
type Item = { trade_id: string; side: Side; galaxy_id: string; held: boolean };
const DAY_MS = 86_400_000;
const HISTORY = 30;
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a');
const sideOf = (t: Trade, accountId: string): Side | null => (t.a_id === accountId ? 'a' : t.b_id === accountId ? 'b' : null);
const isOpen = (t: Trade, now: Date) => t.status === 'open' && new Date(t.expires_at) > now;
/** One side's columns, read. */
const cols = (t: Trade, s: Side) =>
  s === 'a'
    ? { id: t.a_id, coins: Number(t.a_coins), hold: t.a_hold, offered: t.a_offered, confirmed: t.a_confirmed }
    : { id: t.b_id, coins: Number(t.b_coins), hold: t.b_hold, offered: t.b_offered, confirmed: t.b_confirmed };
/** One side's columns, written. */
function sideSet(s: Side, v: { coins?: number; hold?: string | null; offered?: boolean; confirmed?: boolean }): Updateable<TradesTable> {
  const k = (name: string) => `${s}_${name}`;
  const out: Record<string, unknown> = {};
  if (v.coins !== undefined) out[k('coins')] = v.coins;
  if (v.hold !== undefined) out[k('hold')] = v.hold;
  if (v.offered !== undefined) out[k('offered')] = v.offered;
  if (v.confirmed !== undefined) out[k('confirmed')] = v.confirmed;
  return out as Updateable<TradesTable>;
}
/** A side's deal now: its galaxies (ids) and coins. */
const dealOf = (t: Trade, items: Item[], s: Side): TradeDealInput => ({ galaxies: items.filter((i) => i.trade_id === t.id && i.side === s).map((i) => i.galaxy_id), coins: cols(t, s).coins });
const sameDeal = (x: TradeDealInput, y: TradeDealInput) => x.coins === y.coins && x.galaxies.length === y.galaxies.length && x.galaxies.every((g) => y.galaxies.includes(g));

async function publicGalaxies(db: Kysely<DB>, ids: string[]): Promise<Map<string, PublicGalaxy>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('galaxy.galaxies')
    .select(['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, seed: String(r.seed), tier: TIERS[r.tier]!, finish: r.finish as PublicGalaxy['finish'], traits: r.traits, name: r.name, designation: r.designation, featured: r.featured, level: r.level },
    ]),
  );
}

async function itemsOf(db: Kysely<DB>, tradeIds: string[]): Promise<Item[]> {
  if (tradeIds.length === 0) return [];
  return db.selectFrom('galaxy.trade_items').select(['trade_id', 'side', 'galaxy_id', 'held']).where('trade_id', 'in', tradeIds).execute();
}

const byRank = (x: PublicGalaxy, y: PublicGalaxy) => TIERS.indexOf(y.tier) - TIERS.indexOf(x.tier) || x.name.localeCompare(y.name, 'es');
const dealSide = (d: TradeEventDeal['a']): TradeDealSide => ({ coins: d.coins, galaxies: d.galaxies.map((g) => ({ id: g.id, name: g.name, tier: TIERS[g.tier] ?? 'common' })) });

async function viewsOf(db: Kysely<DB>, accountId: string, trades: Trade[], now: Date): Promise<TradeView[]> {
  if (trades.length === 0) return [];
  const ids = trades.map((t) => t.id);
  const [items, events] = await Promise.all([
    itemsOf(db, ids),
    db.selectFrom('galaxy.trade_events').select(['trade_id', 'version', 'actor_id', 'kind', 'deal', 'created_at']).where('trade_id', 'in', ids).orderBy('id').execute(),
  ]);
  const galaxies = await publicGalaxies(
    db,
    items.map((i) => i.galaxy_id),
  );
  const people = [...new Set(trades.flatMap((t) => [t.a_id, t.b_id]))];
  const names = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', people).execute();
  const nameOf = new Map(names.map((n) => [n.id, n.username]));
  return trades.map((t) => {
    const me: Side = t.a_id === accountId ? 'a' : 'b';
    const them = other(me);
    const side = (s: Side) => ({
      galaxies: items
        .filter((i) => i.trade_id === t.id && i.side === s)
        .map((i) => galaxies.get(i.galaxy_id))
        .filter((g): g is PublicGalaxy => g !== undefined)
        .sort(byRank),
      coins: cols(t, s).coins,
      confirmed: cols(t, s).confirmed,
    });
    const history: TradeEvent[] = events
      .filter((e) => e.trade_id === t.id)
      .slice(-HISTORY)
      .map((e) => ({
        version: e.version,
        kind: e.kind,
        byMe: e.actor_id === accountId,
        at: new Date(e.created_at).toISOString(),
        deal: e.deal ? { me: dealSide(e.deal[me]), them: dealSide(e.deal[them]) } : null,
      }));
    const status = t.status === 'open' && new Date(t.expires_at) <= now ? 'expired' : t.status;
    return {
      id: t.id,
      version: t.version,
      status,
      createdAt: new Date(t.created_at).toISOString(),
      expiresAt: new Date(t.expires_at).toISOString(),
      proposedByMe: me === 'a',
      me: side(me),
      them: { username: nameOf.get(cols(t, them).id) ?? '', ...side(them) },
      commission: t.commission === null ? null : Number(t.commission),
      history,
      post: t.post_id,
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

/** Every galaxy a change touches, locked in id order, so two trades never wait on each other in a circle. */
async function lockGalaxies(trx: Kysely<DB>, ids: string[]): Promise<void> {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length) await trx.selectFrom('galaxy.galaxies').select('id').where('id', 'in', sorted).orderBy('id').forUpdate().execute();
}

/**
 * A galaxy its owner puts into a trade: the owner's and alive, and not equipped, exhibited, listed or offered in another
 * open trade. Open trades holding it that expired end first (their hold is not real any more).
 */
async function holdable(trx: Kysely<DB>, galaxyId: string, ownerId: string, tradeId: string | null): Promise<void> {
  const g = await trx.selectFrom('galaxy.galaxies').select('id').where('id', '=', galaxyId).where('owner_id', '=', ownerId).where('disintegrated_at', 'is', null).executeTakeFirst();
  if (!g) throw new HttpError(404, 'galaxy_not_found');
  if (await isEquipped(trx, [galaxyId])) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, [galaxyId])) throw new HttpError(409, 'galaxy_exhibited');
  if (await isListed(trx, [galaxyId])) throw new HttpError(409, 'galaxy_listed');
  await trx
    .updateTable('galaxy.trades')
    .set({ status: 'expired', closed_at: sql<Date>`now()` })
    .where('status', '=', 'open')
    .where('expires_at', '<=', sql<Date>`now()`)
    .where('id', 'in', (eb) => eb.selectFrom('galaxy.trade_items').select('trade_id').where('galaxy_id', '=', galaxyId).where('held', '=', true))
    .execute();
  if (await isTraded(trx, [galaxyId], tradeId)) throw new HttpError(409, 'galaxy_in_trade');
}

/** A galaxy one side asks of the other: the other's and alive (not held: its owner has not agreed yet). */
async function askable(db: Kysely<DB>, galaxyId: string, ownerId: string): Promise<void> {
  const g = await db.selectFrom('galaxy.galaxies').select('id').where('id', '=', galaxyId).where('owner_id', '=', ownerId).where('disintegrated_at', 'is', null).executeTakeFirst();
  if (!g) throw new HttpError(404, 'galaxy_not_found');
}

/** The deal checks before any galaxy is read: the shared ones (size, duplicates, coins on one side, the top price). */
function checkDeal(give: TradeDealInput, want: TradeDealInput, cfgs: MarketConfigs): void {
  const problem = dealProblem(give, want, { tradeGalaxies: cfgs.market.tradeGalaxies, maxPrice: cfgs.market.maxPrice });
  if (problem) throw new HttpError(400, problem);
}

/**
 * Sets one side of a trade to `deal`: offered (held) by its owner, or only asked of them. Its old coins hold goes back
 * unless the same coins stay offered; its galaxies are replaced (each checked: held ones free of anything else, asked
 * ones theirs and alive), and new coins are held from its owner's balance.
 */
async function setSide(trx: Kysely<DB>, t: Trade, s: Side, deal: TradeDealInput, offer: boolean): Promise<void> {
  const now = cols(t, s);
  const keepHold = offer && now.offered && now.hold !== null && deal.coins === now.coins;
  if (now.hold && !keepHold) await releaseHold(trx, now.hold, 'trade_release', { trade: t.id });
  await trx.deleteFrom('galaxy.trade_items').where('trade_id', '=', t.id).where('side', '=', s).execute();
  for (const g of deal.galaxies) {
    if (offer) await holdable(trx, g, now.id, t.id);
    else await askable(trx, g, now.id);
  }
  if (deal.galaxies.length) await trx.insertInto('galaxy.trade_items').values(deal.galaxies.map((g) => ({ trade_id: t.id, side: s, galaxy_id: g, held: offer }))).execute();
  let hold = keepHold ? now.hold : null;
  if (offer && deal.coins > 0 && !keepHold) {
    const h = await trx.insertInto('galaxy.coin_holds').values({ account_id: now.id, amount: deal.coins, kind: 'trade' }).returning('id').executeTakeFirstOrThrow();
    await debit(trx, now.id, 'coins', deal.coins, 'trade_hold', { trade: t.id, hold: h.id });
    hold = h.id;
  }
  await trx
    .updateTable('galaxy.trades')
    .set(sideSet(s, { coins: deal.coins, hold, offered: offer && givesSomething(deal) }))
    .where('id', '=', t.id)
    .execute();
}

/** The trade's deal as it stands, with names and tiers, as its history keeps it. */
async function snapshot(trx: Kysely<DB>, tradeId: string): Promise<TradeEventDeal> {
  const t = await trx.selectFrom('galaxy.trades').select(['a_coins', 'b_coins']).where('id', '=', tradeId).executeTakeFirstOrThrow();
  const rows = await trx
    .selectFrom('galaxy.trade_items as i')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'i.galaxy_id')
    .select(['i.side', 'g.id', 'g.name', 'g.tier'])
    .where('i.trade_id', '=', tradeId)
    .orderBy('g.tier', 'desc')
    .orderBy('g.name')
    .execute();
  const of = (s: Side) => rows.filter((r) => r.side === s).map((r) => ({ id: r.id, name: r.name, tier: r.tier }));
  return { a: { galaxies: of('a'), coins: Number(t.a_coins) }, b: { galaxies: of('b'), coins: Number(t.b_coins) } };
}

async function logEvent(trx: Kysely<DB>, tradeId: string, version: number, actorId: string, kind: TradeEvent['kind']): Promise<void> {
  const deal = kind === 'proposed' || kind === 'countered' ? JSON.stringify(await snapshot(trx, tradeId)) : null;
  await trx.insertInto('galaxy.trade_events').values({ trade_id: tradeId, version, actor_id: actorId, kind, deal }).execute();
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
    rules: {
      ...rules,
      openTrades: Math.max(0, cfgs.market.openTrades - open),
      tradesLeft: Math.max(0, cfgs.market.perDay.trades - today),
      tradeDays: cfgs.market.tradeDays,
      tradeGalaxies: cfgs.market.tradeGalaxies,
    },
  };
}

/** Proposes a swap (inside its operation): the gates, the limits, what I give in escrow and, if named, what I want. */
export async function proposeTrade(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, req: TradePropose, now: Date, out?: Notices): Promise<TradeView> {
  checkDeal(req.give, req.want, cfgs);
  if (!givesSomething(req.give)) throw new HttpError(400, 'trade_empty');
  const target = await trx.selectFrom('galaxy.accounts').select('id').where('username', '=', req.username).executeTakeFirst();
  if (!target) throw new HttpError(404, 'profile_not_found');
  if (target.id === accountId) throw new HttpError(409, 'trade_self');
  // Blocked pairs do not trade (2026-11-14).
  if (await blockedBetween(trx, accountId, target.id)) throw new HttpError(403, 'trade_blocked');
  // Both traders, in id order: their counts hold under concurrent proposals (M5c-2 review).
  for (const who of [accountId, target.id].sort()) await lockTrader(trx, who);
  refuse(await rulesFor(trx, accountId, cfgs, now));
  // One open trade per pair of accounts (an expired one still holds the pair's slot: it ends now).
  const pair = (eb: ExpressionBuilder<DB, 'galaxy.trades'>) =>
    eb.or([eb.and([eb('a_id', '=', accountId), eb('b_id', '=', target.id)]), eb.and([eb('a_id', '=', target.id), eb('b_id', '=', accountId)])]);
  await trx.updateTable('galaxy.trades').set({ status: 'expired', closed_at: sql<Date>`now()` }).where('status', '=', 'open').where('expires_at', '<=', sql<Date>`now()`).where(pair).execute();
  const between = await trx.selectFrom('galaxy.trades').select('id').where('status', '=', 'open').where(pair).executeTakeFirst();
  if (between) throw new HttpError(409, 'trade_exists');
  // What I proposed counts against me; what someone receives, against them: proposals sent to me never stop mine.
  if ((await openCount(trx, accountId, now, 'a')) >= cfgs.market.openTrades) throw new HttpError(409, 'trade_limit');
  // An answer to a board post asks what the post gives, and counts against the post (not its author's open trades).
  if (req.post) await checkAnswer(trx, cfgs, req.post, target.id, req.want, now);
  else if ((await openCount(trx, target.id, now, 'b')) >= cfgs.market.openTrades) throw new HttpError(409, 'trade_limit_them');
  if ((await proposalsToday(trx, accountId, now)) >= cfgs.market.perDay.trades) throw new HttpError(429, 'trade_daily_cap');
  await lockGalaxies(trx, [...req.give.galaxies, ...req.want.galaxies]);
  const row = await trx
    .insertInto('galaxy.trades')
    .values({ a_id: accountId, b_id: target.id, post_id: req.post ?? null, created_at: now, expires_at: new Date(now.getTime() + cfgs.market.tradeDays * DAY_MS) })
    .returning('id')
    .executeTakeFirstOrThrow();
  const fresh = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', row.id).executeTakeFirstOrThrow();
  await setSide(trx, fresh, 'a', req.give, true);
  await setSide(trx, fresh, 'b', req.want, false);
  // Proposing a complete deal confirms it.
  if (givesSomething(req.want)) await trx.updateTable('galaxy.trades').set({ a_confirmed: true }).where('id', '=', row.id).execute();
  await logEvent(trx, row.id, 1, accountId, 'proposed');
  out?.add(target.id, { kind: 'trade', event: 'proposed', trade: row.id, from: await noticePlayer(trx, accountId) });
  return viewOf(trx, accountId, row.id, now);
}

/** The trade, locked, with the caller's side; 409 trade_gone when it is not theirs or no longer open. */
async function lockOpen(trx: Kysely<DB>, accountId: string, id: string, now: Date): Promise<{ t: Trade; side: Side }> {
  const t = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  const side = t ? sideOf(t, accountId) : null;
  if (!t || !side || !isOpen(t, now)) throw new HttpError(409, 'trade_gone');
  return { t, side };
}

/**
 * Changes what I give and what I want of the other (naming the version I saw): a counter-offer. What I give is held
 * now; what I ask of them is free until they agree. A change is a new version that only I have confirmed (when both
 * sides give something); saving the deal as it stands after they confirmed it is accepting it.
 */
export async function changeTrade(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, id: string, req: TradeOffer, now: Date, out?: Notices): Promise<TradeView> {
  const { t, side } = await lockOpen(trx, accountId, id, now);
  if (req.version !== t.version) throw new HttpError(409, 'trade_changed');
  refuse(await rulesFor(trx, accountId, cfgs, now));
  checkDeal(req.give, req.want, cfgs);
  const them = other(side);
  const items = await itemsOf(trx, [t.id]);
  const mine = dealOf(t, items, side);
  const theirs = dealOf(t, items, them);
  const me0 = cols(t, side);
  const them0 = cols(t, them);
  const giveChanged = !sameDeal(req.give, mine);
  const wantChanged = !sameDeal(req.want, theirs);
  const changed = giveChanged || wantChanged;
  await lockGalaxies(trx, [...req.give.galaxies, ...req.want.galaxies, ...mine.galaxies, ...theirs.galaxies]);
  if (giveChanged || (!me0.offered && givesSomething(req.give))) await setSide(trx, t, side, req.give, true);
  if (wantChanged) await setSide(trx, t, them, req.want, false);
  const complete = givesSomething(req.give) && givesSomething(req.want);
  const version = changed ? t.version + 1 : t.version;
  await trx
    .updateTable('galaxy.trades')
    .set({ version, ...sideSet(side, { confirmed: complete }), ...sideSet(them, { confirmed: changed ? false : them0.confirmed }) })
    .where('id', '=', t.id)
    .execute();
  if (changed) await logEvent(trx, t.id, version, accountId, 'countered');
  // Saving the deal as it stands, after the other side confirmed it, is accepting it.
  const swapped = complete && !changed && them0.confirmed ? await swap(trx, cfgs, t.id, accountId, now, out) : false;
  if (!changed && !swapped && complete && !me0.confirmed) await logEvent(trx, t.id, version, accountId, 'confirmed');
  // The other side hears it: the deal done, changed, or confirmed by me (their turn).
  const event = swapped ? 'done' : changed ? 'countered' : complete && !me0.confirmed ? 'confirmed' : null;
  if (event) out?.add(them0.id, { kind: 'trade', event, trade: t.id, from: await noticePlayer(trx, accountId) });
  return viewOf(trx, accountId, t.id, now);
}

/** The highest tier a side gives, or -1 with no galaxies. */
const topTier = (rows: { side: Side; tier: number }[], s: Side) => Math.max(-1, ...rows.filter((r) => r.side === s).map((r) => r.tier));

/**
 * The swap of a trade both sides confirmed (its row locked by the caller): both sides still allowed, every galaxy still
 * its giver's, alive and held by nothing else; the galaxies locked in id order. Then they change hands, the held coins
 * pay the other side (less the market's commission), and the trade is done.
 */
async function swap(trx: Kysely<DB>, cfgs: MarketConfigs, id: string, actorId: string, now: Date, out?: Notices): Promise<boolean> {
  const t = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  if (!t.a_confirmed || !t.b_confirmed) return false;
  const items = await itemsOf(trx, [t.id]);
  const ids = items.map((i) => i.galaxy_id);
  await lockGalaxies(trx, ids);
  const banned = await trx.selectFrom('galaxy.accounts').select('id').where('id', 'in', [t.a_id, t.b_id]).where('banned_until', '>', now).executeTakeFirst();
  if (banned) throw new HttpError(409, 'trade_gone');
  const live = ids.length ? await trx.selectFrom('galaxy.galaxies').select(['id', 'owner_id', 'tier']).where('id', 'in', ids).where('disintegrated_at', 'is', null).execute() : [];
  for (const i of items) {
    if (!live.some((g) => g.id === i.galaxy_id && g.owner_id === cols(t, i.side).id)) throw new HttpError(409, 'trade_gone');
  }
  if (ids.length) {
    if (await isEquipped(trx, ids)) throw new HttpError(409, 'galaxy_equipped');
    if (await isExhibited(trx, ids)) throw new HttpError(409, 'galaxy_exhibited');
    if (await isListed(trx, ids)) throw new HttpError(409, 'galaxy_listed');
    if (await isTraded(trx, ids, t.id)) throw new HttpError(409, 'galaxy_in_trade');
  }
  const of = (s: Side) => items.filter((i) => i.side === s).map((i) => i.galaxy_id);
  if (of('a').length) await trx.updateTable('galaxy.galaxies').set({ owner_id: t.b_id, locked: false }).where('id', 'in', of('a')).execute();
  if (of('b').length) await trx.updateTable('galaxy.galaxies').set({ owner_id: t.a_id, locked: false }).where('id', 'in', of('b')).execute();
  // The coins (one side at most) were held when that side offered them: spent now, the other side paid.
  const payer: Side | null = Number(t.a_coins) > 0 ? 'a' : Number(t.b_coins) > 0 ? 'b' : null;
  let commission: number | null = null;
  if (payer) {
    const p = cols(t, payer);
    const spent = p.hold ? await trx.updateTable('galaxy.coin_holds').set({ status: 'spent', closed_at: now }).where('id', '=', p.hold).where('status', '=', 'held').returning('id').executeTakeFirst() : undefined;
    if (!spent) throw new HttpError(409, 'trade_gone');
    commission = commissionOf(p.coins, cfgs.market.commission);
    if (p.coins - commission > 0) await credit(trx, cols(t, other(payer)).id, 'coins', p.coins - commission, 'trade_coins', { trade: t.id });
  }
  await trx.updateTable('galaxy.trades').set({ status: 'done', closed_at: now, commission }).where('id', '=', t.id).execute();
  await logEvent(trx, t.id, t.version, actorId, 'done');
  // An answer to a board post: the post closes and its other answers are cancelled.
  if (t.post_id) await closePost(trx, t.post_id, t.id, actorId, now, out);
  const tiers = items.map((i) => ({ side: i.side, tier: live.find((g) => g.id === i.galaxy_id)!.tier }));
  await alertIfSuspicious(trx, cfgs, { trade: t.id, a: t.a_id, b: t.b_id, tiers, coins: payer ? { side: payer, amount: cols(t, payer).coins } : null }, now);
  return true;
}

/** Confirms the version I saw (what I give is held now if it was not); when the other side confirmed it too, the swap. */
export async function confirmTrade(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, id: string, version: number, now: Date, out?: Notices): Promise<TradeView> {
  const { t, side } = await lockOpen(trx, accountId, id, now);
  if (version !== t.version) throw new HttpError(409, 'trade_changed');
  refuse(await rulesFor(trx, accountId, cfgs, now));
  const items = await itemsOf(trx, [t.id]);
  const mine = dealOf(t, items, side);
  if (!givesSomething(mine) || !givesSomething(dealOf(t, items, other(side)))) throw new HttpError(409, 'trade_incomplete');
  await lockGalaxies(
    trx,
    items.map((i) => i.galaxy_id),
  );
  const me = cols(t, side);
  if (!me.offered) await setSide(trx, t, side, mine, true);
  await trx.updateTable('galaxy.trades').set(sideSet(side, { confirmed: true })).where('id', '=', t.id).execute();
  const them = cols(t, other(side));
  if (!them.confirmed) {
    if (!me.confirmed) await logEvent(trx, t.id, t.version, accountId, 'confirmed');
    out?.add(them.id, { kind: 'trade', event: 'confirmed', trade: t.id, from: await noticePlayer(trx, accountId) });
    return viewOf(trx, accountId, t.id, now);
  }
  if (await swap(trx, cfgs, t.id, accountId, now, out)) out?.add(them.id, { kind: 'trade', event: 'done', trade: t.id, from: await noticePlayer(trx, accountId) });
  return viewOf(trx, accountId, t.id, now);
}

export async function cancelTrade(deps: MarketDeps, accountId: string, id: string): Promise<TradeView> {
  const now = deps.now();
  return withNotices(deps.live, (out) =>
    deps.db.transaction().execute(async (trx) => {
      const t = await trx.selectFrom('galaxy.trades').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      const side = t ? sideOf(t, accountId) : null;
      if (!t || !side || t.status !== 'open') throw new HttpError(409, 'trade_gone');
      // Closing it frees what it held (the database does it on the status change).
      await trx.updateTable('galaxy.trades').set({ status: 'cancelled', closed_at: now }).where('id', '=', t.id).execute();
      await logEvent(trx, t.id, t.version, accountId, 'cancelled');
      out.add(cols(t, other(side)).id, { kind: 'trade', event: 'cancelled', trade: t.id, from: await noticePlayer(trx, accountId) });
      return viewOf(trx, accountId, t.id, now);
    }),
  );
}

/** Ends the open trades past their date (the market job; a batch at a time, skipping locked rows): what they held, back. */
export async function expireTrades(db: Kysely<DB>, batch = 500): Promise<number> {
  const res = await db
    .updateTable('galaxy.trades')
    .set({ status: 'expired', closed_at: sql<Date>`now()` })
    .where('id', 'in', (eb) => eb.selectFrom('galaxy.trades').select('id').where('status', '=', 'open').where('expires_at', '<=', sql<Date>`now()`).orderBy('expires_at').limit(batch).forUpdate().skipLocked())
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}

/**
 * An alert for the admin (M6): the two accounts shared an IP lately, or the deal is far from even: the rarest galaxy of
 * each side far apart, or coins alone against galaxies worth more than them by the floor of the rarest one.
 */
async function alertIfSuspicious(
  trx: Kysely<DB>,
  cfgs: MarketConfigs,
  deal: { trade: string; a: string; b: string; tiers: { side: Side; tier: number }[]; coins: { side: Side; amount: number } | null },
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - cfgs.market.sharedIpDays * DAY_MS);
  const shared = await trx
    .selectFrom('galaxy.account_ips as x')
    .innerJoin('galaxy.account_ips as y', 'y.ip', 'x.ip')
    .select('x.ip')
    .where('x.account_id', '=', deal.a)
    .where('y.account_id', '=', deal.b)
    .where('x.last_seen', '>=', since)
    .where('y.last_seen', '>=', since)
    .limit(1)
    .executeTakeFirst();
  const alerts: { kind: 'shared_ip' | 'unbalanced'; details: Record<string, unknown> }[] = [];
  if (shared) alerts.push({ kind: 'shared_ip', details: { ip: shared.ip } });
  const [ta, tb] = [topTier(deal.tiers, 'a'), topTier(deal.tiers, 'b')];
  if (ta >= 0 && tb >= 0 && Math.abs(ta - tb) >= cfgs.market.tradeAlertTierGap) alerts.push({ kind: 'unbalanced', details: { tierGap: Math.abs(ta - tb) } });
  else if (deal.coins) {
    // Coins for galaxies: fewer coins than the floor of the rarest galaxy they bought.
    const bought = topTier(deal.tiers, other(deal.coins.side));
    const floor = bought >= 0 ? minPriceFor(TIERS[bought]!, cfgs.market) : 0;
    if (topTier(deal.tiers, deal.coins.side) < 0 && deal.coins.amount < floor) alerts.push({ kind: 'unbalanced', details: { coins: deal.coins.amount, floor } });
  }
  if (alerts.length === 0) return;
  await trx
    .insertInto('galaxy.trade_alerts')
    .values(alerts.map((x) => ({ kind: x.kind, trade_id: deal.trade, seller_id: deal.a, buyer_id: deal.b, details: JSON.stringify(x.details) })))
    .execute();
}
