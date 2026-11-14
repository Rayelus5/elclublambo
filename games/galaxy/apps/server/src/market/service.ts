import {
  type AccountConfig,
  commissionOf,
  type GalaxySummary,
  levelOf,
  listable,
  type MarketConfig,
  type MarketListing,
  type MarketPage,
  type MarketQuery,
  type MarketRules,
  type MarketSort,
  type MarketStats,
  minPriceFor,
  type MyMarket,
  type SoldListing,
  TIERS,
  tradeBlock,
  type Wallet,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { summary } from '../collection/service';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { nextMadridMidnight } from '../economy/day';
import { credit, debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { type Notices, noticePlayer, type WithLive } from '../realtime/notices';
import { accountXp } from '../social/progress';
import { type CursorValue, decodeCursor, encodeCursor } from './cursor';
import { isEquipped, isExhibited, isListed, isTraded } from './escrow';

// The market (GDD §14.6, §14.7; M5c-1). Listing puts a galaxy in escrow until it is sold, withdrawn or expires. Buying
// locks the listing first, so two buyers (or a buyer and the seller withdrawing) never both win; the buyer pays the
// price and the seller gets it minus the commission, which leaves the economy. Trading needs the level and the days of
// account; today's listings and purchases are capped; a sale between accounts that shared an IP, or at a price far
// above the floor, leaves an alert for the admin (the sale goes through).

/** `live`: the live hub, for the notices of a sale and of a trade (real-time notices plan); none in the CLI. */
export type MarketDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date } & WithLive;
export type MarketConfigs = { market: MarketConfig; account: AccountConfig };

const PAGE = 24;
const DAY_MS = 86_400_000;

export async function marketConfigs(deps: MarketDeps): Promise<MarketConfigs> {
  const [market, account] = await Promise.all([deps.config.get('market'), deps.config.get('account')]);
  return { market, account };
}

/** One account's market actions, one at a time: today's caps are counted and used under it (M5c-1 review). */
export async function lockTrader(trx: Kysely<DB>, accountId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`market-cap:${accountId}`}, 0))`.execute(trx);
}

/** Midnight of today in Madrid, where the daily limits restart. */
export const todayStart = (now: Date) => new Date(nextMadridMidnight(new Date(now.getTime() - DAY_MS)).getTime());

export async function rulesFor(db: Kysely<DB>, accountId: string, cfgs: MarketConfigs, now: Date): Promise<MarketRules> {
  const { market } = cfgs;
  const [account, xp, listed, bought] = await Promise.all([
    db.selectFrom('galaxy.accounts').select('created_at').where('id', '=', accountId).executeTakeFirstOrThrow(),
    accountXp(db, accountId),
    db.selectFrom('galaxy.market_listings').select(sql<number>`count(*)::int`.as('n')).where('seller_id', '=', accountId).where('listed_at', '>=', todayStart(now)).executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.market_listings').select(sql<number>`count(*)::int`.as('n')).where('buyer_id', '=', accountId).where('sold_at', '>=', todayStart(now)).executeTakeFirstOrThrow(),
  ]);
  const reason = tradeBlock(levelOf(xp, cfgs.account).level, new Date(account.created_at), now, market);
  return {
    commission: market.commission,
    minPrice: Object.fromEntries(TIERS.map((t) => [t, minPriceFor(t, market)])) as MarketRules['minPrice'],
    mythicListing: market.mythicListing,
    maxPrice: market.maxPrice,
    canTrade: reason === null,
    reason,
    minLevel: market.minLevel,
    minAccountDays: market.minAccountDays,
    listingsLeft: Math.max(0, market.perDay.listings - listed.n),
    purchasesLeft: Math.max(0, market.perDay.purchases - bought.n),
    days: market.days,
  };
}

/** Refuses a trade with the live requirement in the body, so the message says what the admin set, not a fixed number. */
export function refuse(rules: MarketRules): void {
  if (rules.reason === 'level') throw new HttpError(403, 'trade_level', { minLevel: rules.minLevel });
  if (rules.reason === 'age') throw new HttpError(403, 'trade_age', { minAccountDays: rules.minAccountDays });
}

const GALAXY = ['g.id', 'g.seed', 'g.tier', 'g.finish', 'g.traits', 'g.name', 'g.designation', 'g.featured', 'g.level', 'g.created_at', 'g.score'] as const;

function listingsQuery(db: Kysely<DB>) {
  return db
    .selectFrom('galaxy.market_listings as m')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'm.galaxy_id')
    .innerJoin('galaxy.accounts as s', 's.id', 'm.seller_id')
    .select([...GALAXY, 'm.id as listing_id', 'm.price', 'm.listed_at', 'm.expires_at', 's.username as seller', 'm.tier as l_tier', 'm.score as l_score', 'm.level as l_level']);
}
type ListingRow = Awaited<ReturnType<ReturnType<typeof listingsQuery>['execute']>>[number];

function listingOf(r: ListingRow): MarketListing {
  return {
    id: r.listing_id,
    galaxy: summary(r),
    seller: r.seller,
    price: Number(r.price),
    listedAt: new Date(r.listed_at).toISOString(),
    expiresAt: new Date(r.expires_at).toISOString(),
  };
}

/**
 * Each order's columns, all the same way (so the keyset is one row comparison), the listing's id last (the tie-break),
 * each on its partial index of the listings on sale (20261114130000_galaxy_market_scale).
 */
const ORDERS: Record<MarketSort, { cols: readonly ('m.listed_at' | 'm.price' | 'm.tier' | 'm.score' | 'm.expires_at' | 'm.level' | 'm.id')[]; dir: 'asc' | 'desc' }> = {
  new: { cols: ['m.listed_at', 'm.id'], dir: 'desc' },
  cheap: { cols: ['m.price', 'm.id'], dir: 'asc' },
  dear: { cols: ['m.price', 'm.id'], dir: 'desc' },
  rare: { cols: ['m.tier', 'm.score', 'm.id'], dir: 'desc' },
  ending: { cols: ['m.expires_at', 'm.id'], dir: 'asc' },
  level: { cols: ['m.level', 'm.id'], dir: 'desc' },
};

/** A row's values in its order's columns, for the next page's cursor. */
function keyOf(sort: MarketSort, r: ListingRow): CursorValue[] {
  const v: Record<string, CursorValue> = {
    'm.listed_at': new Date(r.listed_at).toISOString(),
    'm.price': Number(r.price),
    'm.tier': Number(r.l_tier ?? 0),
    'm.score': Number(r.l_score ?? 0),
    'm.expires_at': new Date(r.expires_at).toISOString(),
    'm.level': Number(r.l_level ?? 1),
    'm.id': r.listing_id,
  };
  return ORDERS[sort].cols.map((c) => v[c]!);
}

/** `like` takes these literally. */
const likeLiteral = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The listings on sale now (the owner, 2026-11-14: «profesional para 100.000 anuncios»), filtered and in an order, a
 * page at a time from a cursor (nothing is counted; `next` goes on), with what the viewer may do.
 */
export async function browseMarket(deps: MarketDeps, accountId: string, q: MarketQuery): Promise<MarketPage> {
  const cfgs = await marketConfigs(deps);
  const now = deps.now();
  let query = listingsQuery(deps.db).where('m.status', '=', 'active').where('m.expires_at', '>', now)
    // Sellers banned right now are hidden (a banned trader is not paid; M5c-1 review).
    .where((eb) => eb.or([eb('s.banned_until', 'is', null), eb('s.banned_until', '<=', sql<Date>`now()`)]));
  if (q.tier) query = query.where('m.tier', '=', TIERS.indexOf(q.tier));
  if (q.finish) query = query.where('m.finish', '=', q.finish);
  if (q.type) query = query.where('m.galaxy_type', '=', q.type);
  if (q.palette) query = query.where('m.palette', '=', q.palette);
  if (q.phenomenon === 'any') query = query.where('m.phenomenon', '<>', 'none');
  else if (q.phenomenon) query = query.where('m.phenomenon', '=', q.phenomenon);
  if (q.minLevel) query = query.where('m.level', '>=', q.minLevel);
  if (q.maxLevel) query = query.where('m.level', '<=', q.maxLevel);
  if (q.minPrice) query = query.where('m.price', '>=', String(q.minPrice));
  if (q.maxPrice) query = query.where('m.price', '<=', String(q.maxPrice));
  if (q.q) query = query.where('m.search', 'like', `%${likeLiteral(q.q.toLowerCase())}%`);
  const order = ORDERS[q.sort];
  if (q.cursor) {
    const values = decodeCursor(q.sort, q.cursor, order.cols.length);
    const op = order.dir === 'desc' ? '<' : '>';
    query = query.where(sql<boolean>`(${sql.join(order.cols.map((c) => sql.ref(c)))}) ${sql.raw(op)} (${sql.join(values.map((v) => sql.val(v)))})`);
  }
  for (const c of order.cols) query = query.orderBy(c, order.dir);
  const rows = await query.limit(PAGE + 1).execute();
  const page = rows.slice(0, PAGE);
  const next = rows.length > PAGE ? encodeCursor(q.sort, keyOf(q.sort, page.at(-1)!)) : null;
  return { listings: page.map(listingOf), next, rules: await rulesFor(deps.db, accountId, cfgs, now) };
}

const EMPTY_STATS: MarketStats = { updatedAt: null, day: { sales: 0, gold: 0, commission: 0 }, week: { sales: 0, gold: 0, commission: 0, trades: 0 }, active: 0, byTier: {}, top: null };

/** The market's public numbers as the job last kept them (none yet: counted now). */
export async function marketStats(deps: Pick<MarketDeps, 'db' | 'now'>): Promise<MarketStats> {
  const row = await deps.db.selectFrom('galaxy.market_stats').select(['data', 'updated_at']).where('id', '=', 1).executeTakeFirst();
  if (row) return { ...(row.data as MarketStats), updatedAt: new Date(row.updated_at).toISOString() };
  return refreshMarketStats(deps.db, deps.now());
}

/**
 * Counts the market's public numbers and keeps them: the sales of the last 24 hours and 7 days (gold paid and the
 * commission that left the economy), the trades done in 7 days, the listings on sale, the week by rarity and its
 * dearest sale.
 */
export async function refreshMarketStats(db: Kysely<DB>, now: Date): Promise<MarketStats> {
  const day = new Date(now.getTime() - DAY_MS);
  const week = new Date(now.getTime() - 7 * DAY_MS);
  const [sold, tiers, top, active, trades] = await Promise.all([
    db
      .selectFrom('galaxy.market_listings')
      .select([
        sql<number>`(count(*) filter (where sold_at > ${day}))::int`.as('day_sales'),
        sql<string>`coalesce(sum(price) filter (where sold_at > ${day}), 0)`.as('day_gold'),
        sql<string>`coalesce(sum(commission) filter (where sold_at > ${day}), 0)`.as('day_commission'),
        sql<number>`count(*)::int`.as('week_sales'),
        sql<string>`coalesce(sum(price), 0)`.as('week_gold'),
        sql<string>`coalesce(sum(commission), 0)`.as('week_commission'),
      ])
      .where('status', '=', 'sold')
      .where('sold_at', '>', week)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('galaxy.market_listings')
      .select(['tier', sql<number>`count(*)::int`.as('n'), sql<string>`round(avg(price))`.as('avg')])
      .where('status', '=', 'sold')
      .where('sold_at', '>', week)
      .groupBy('tier')
      .execute(),
    db
      .selectFrom('galaxy.market_listings as m')
      .innerJoin('galaxy.galaxies as g', 'g.id', 'm.galaxy_id')
      .select(['g.name', 'g.tier', 'm.price', 'm.sold_at'])
      .where('m.status', '=', 'sold')
      .where('m.sold_at', '>', week)
      .orderBy('m.price', 'desc')
      .limit(1)
      .executeTakeFirst(),
    db.selectFrom('galaxy.market_listings').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'active').where('expires_at', '>', now).executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.trades').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'done').where('closed_at', '>', week).executeTakeFirstOrThrow(),
  ]);
  const stats: MarketStats = {
    ...EMPTY_STATS,
    updatedAt: now.toISOString(),
    day: { sales: sold.day_sales, gold: Number(sold.day_gold), commission: Number(sold.day_commission) },
    week: { sales: sold.week_sales, gold: Number(sold.week_gold), commission: Number(sold.week_commission), trades: trades.n },
    active: active.n,
    byTier: Object.fromEntries(tiers.filter((r) => r.tier !== null && TIERS[r.tier]).map((r) => [TIERS[r.tier!]!, { sales: r.n, avg: Number(r.avg) }])),
    top: top ? { name: top.name, tier: TIERS[top.tier]!, price: Number(top.price), at: new Date(top.sold_at!).toISOString() } : null,
  };
  const data = JSON.stringify({ ...stats, updatedAt: undefined });
  await db
    .insertInto('galaxy.market_stats')
    .values({ id: 1, data, updated_at: now })
    .onConflict((oc) => oc.column('id').doUpdateSet({ data, updated_at: now }))
    .execute();
  return stats;
}

/** One's own listings on sale and the latest sales. */
export async function myMarket(deps: MarketDeps, accountId: string): Promise<MyMarket> {
  const cfgs = await marketConfigs(deps);
  const now = deps.now();
  const [active, sold] = await Promise.all([
    listingsQuery(deps.db).where('m.seller_id', '=', accountId).where('m.status', '=', 'active').where('m.expires_at', '>', now).orderBy('m.listed_at', 'desc').execute(),
    listingsQuery(deps.db)
      .leftJoin('galaxy.accounts as b', 'b.id', 'm.buyer_id')
      .select(['b.username as buyer', 'm.sold_at', 'm.commission'])
      .where('m.seller_id', '=', accountId)
      .where('m.status', '=', 'sold')
      .orderBy('m.sold_at', 'desc')
      .limit(50)
      .execute(),
  ]);
  return {
    active: active.map(listingOf),
    sold: sold.map(
      (r): SoldListing => ({
        ...listingOf(r),
        buyer: r.buyer ?? '',
        net: Number(r.price) - Number(r.commission ?? 0),
        soldAt: new Date(r.sold_at!).toISOString(),
      }),
    ),
    rules: await rulesFor(deps.db, accountId, cfgs, now),
  };
}

/** Puts a galaxy on sale (inside its operation): the gates, today's cap, the escrow, then the price. */
export async function listGalaxy(cfgs: MarketConfigs, trx: Kysely<DB>, accountId: string, req: { galaxyId: string; price: number }, now: Date): Promise<MarketListing> {
  await lockTrader(trx, accountId);
  const rules = await rulesFor(trx, accountId, cfgs, now);
  refuse(rules);
  if (rules.listingsLeft <= 0) throw new HttpError(429, 'trade_daily_cap');
  const g = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'tier'])
    .where('id', '=', req.galaxyId)
    .where('owner_id', '=', accountId)
    .where('disintegrated_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!g) throw new HttpError(404, 'galaxy_not_found');
  if (await isEquipped(trx, [g.id])) throw new HttpError(409, 'galaxy_equipped');
  if (await isExhibited(trx, [g.id])) throw new HttpError(409, 'galaxy_exhibited');
  // An expired listing of it still holds the unique slot: it ends now.
  await trx
    .updateTable('galaxy.market_listings')
    .set({ status: 'expired' })
    .where('galaxy_id', '=', g.id)
    .where('status', '=', 'active')
    .where('expires_at', '<=', sql<Date>`now()`)
    .execute();
  if (await isListed(trx, [g.id])) throw new HttpError(409, 'galaxy_listed');
  if (await isTraded(trx, [g.id])) throw new HttpError(409, 'galaxy_in_trade');
  // A mythic stays out of the market unless the admin allows it (plan «rareza Mítica»); swaps always may.
  if (!listable(TIERS[g.tier]!, cfgs.market)) throw new HttpError(409, 'mythic_not_listable');
  if (req.price < minPriceFor(TIERS[g.tier]!, cfgs.market)) throw new HttpError(400, 'price_too_low');
  if (req.price > cfgs.market.maxPrice) throw new HttpError(400, 'price_too_high');
  const row = await trx
    .insertInto('galaxy.market_listings')
    .values({ galaxy_id: g.id, seller_id: accountId, price: req.price, listed_at: now, expires_at: new Date(now.getTime() + cfgs.market.days * DAY_MS) })
    .returning('id')
    .executeTakeFirstOrThrow();
  return listingOf((await listingsQuery(trx).where('m.id', '=', row.id).executeTakeFirstOrThrow()) as ListingRow);
}

/** Withdraws one's own active listing; 409 listing_gone when it was sold or withdrawn first. */
export async function cancelListing(deps: MarketDeps, accountId: string, id: string): Promise<{ cancelled: true }> {
  const done = await deps.db
    .updateTable('galaxy.market_listings')
    .set({ status: 'cancelled' })
    .where('id', '=', id)
    .where('seller_id', '=', accountId)
    .where('status', '=', 'active')
    .executeTakeFirst();
  if (Number(done.numUpdatedRows) === 0) throw new HttpError(409, 'listing_gone');
  return { cancelled: true };
}

/** Buys a listing (inside its operation): the gates, today's cap, the listing locked, the coins, the galaxy, the alerts. */
export async function buyListing(
  cfgs: MarketConfigs,
  trx: Kysely<DB>,
  buyerId: string,
  id: string,
  now: Date,
  opKey: string,
  out?: Notices,
): Promise<{ galaxy: GalaxySummary; wallet: Wallet }> {
  await lockTrader(trx, buyerId);
  const rules = await rulesFor(trx, buyerId, cfgs, now);
  refuse(rules);
  if (rules.purchasesLeft <= 0) throw new HttpError(429, 'trade_daily_cap');
  const l = await trx
    .selectFrom('galaxy.market_listings')
    .select(['id', 'galaxy_id', 'seller_id', 'price', 'status', 'expires_at'])
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!l || l.status !== 'active' || new Date(l.expires_at) <= now) throw new HttpError(409, 'listing_gone');
  if (l.seller_id === buyerId) throw new HttpError(409, 'own_listing');
  const seller = await trx.selectFrom('galaxy.accounts').select('banned_until').where('id', '=', l.seller_id).executeTakeFirst();
  if (!seller || (seller.banned_until && new Date(seller.banned_until) > now)) throw new HttpError(409, 'listing_gone');
  const g = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'tier'])
    .where('id', '=', l.galaxy_id)
    .where('owner_id', '=', l.seller_id)
    .where('disintegrated_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!g) throw new HttpError(409, 'listing_gone');
  // Fresh statements after the galaxy's lock: a seller who equipped, exhibited or offered it in a swap the instant its listing expired
  // (while this purchase waited) keeps it.
  if ((await isEquipped(trx, [g.id])) || (await isExhibited(trx, [g.id])) || (await isTraded(trx, [g.id]))) throw new HttpError(409, 'listing_gone');
  const price = Number(l.price);
  const commission = commissionOf(price, cfgs.market.commission);
  const ref = { listing: l.id, galaxy: g.id };
  await debit(trx, buyerId, 'coins', price, 'market_buy', ref, opKey);
  if (price - commission > 0) await credit(trx, l.seller_id, 'coins', price - commission, 'market_sale', ref, opKey);
  await trx.updateTable('galaxy.galaxies').set({ owner_id: buyerId, locked: false }).where('id', '=', g.id).execute();
  await trx.updateTable('galaxy.market_listings').set({ status: 'sold', buyer_id: buyerId, sold_at: now, commission }).where('id', '=', l.id).execute();
  await alertIfSuspicious(trx, cfgs.market, { listing: l.id, seller: l.seller_id, buyer: buyerId, price, floor: minPriceFor(TIERS[g.tier]!, cfgs.market) }, now);
  const bought = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id', 'seed', 'tier', 'finish', 'traits', 'name', 'designation', 'featured', 'level', 'created_at', 'score'])
    .where('id', '=', g.id)
    .executeTakeFirstOrThrow();
  // The seller hears it (real-time notices plan): what it fetched, what they got and their wallet now.
  out?.add(l.seller_id, {
    kind: 'sale',
    listing: l.id,
    galaxy: { id: g.id, name: bought.name, tier: TIERS[bought.tier]! },
    price,
    net: price - commission,
    buyer: await noticePlayer(trx, buyerId),
    wallet: await getWallet(trx, l.seller_id),
  });
  return { galaxy: summary(bought), wallet: await getWallet(trx, buyerId) };
}

/** An alert for the admin (shown in M6): the two accounts shared an IP lately, or the price is far above the floor. */
async function alertIfSuspicious(
  trx: Kysely<DB>,
  cfg: MarketConfig,
  sale: { listing: string; seller: string; buyer: string; price: number; floor: number },
  now: Date,
): Promise<void> {
  const since = new Date(now.getTime() - cfg.sharedIpDays * DAY_MS);
  const shared = await trx
    .selectFrom('galaxy.account_ips as a')
    .innerJoin('galaxy.account_ips as b', 'b.ip', 'a.ip')
    .select('a.ip')
    .where('a.account_id', '=', sale.seller)
    .where('b.account_id', '=', sale.buyer)
    .where('a.last_seen', '>=', since)
    .where('b.last_seen', '>=', since)
    .limit(1)
    .executeTakeFirst();
  const alerts: { kind: 'shared_ip' | 'unbalanced'; details: Record<string, unknown> }[] = [];
  if (shared) alerts.push({ kind: 'shared_ip', details: { ip: shared.ip } });
  if (sale.price >= cfg.alertMultiple * sale.floor) alerts.push({ kind: 'unbalanced', details: { price: sale.price, floor: sale.floor } });
  if (alerts.length === 0) return;
  await trx
    .insertInto('galaxy.trade_alerts')
    .values(alerts.map((a) => ({ kind: a.kind, listing_id: sale.listing, seller_id: sale.seller, buyer_id: sale.buyer, details: JSON.stringify(a.details) })))
    .execute();
}
