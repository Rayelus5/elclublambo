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
    .select([...GALAXY, 'm.id as listing_id', 'm.price', 'm.listed_at', 'm.expires_at', 's.username as seller']);
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

/** The listings on sale now, filtered, sorted and paged, with what the viewer may do. */
export async function browseMarket(deps: MarketDeps, accountId: string, q: MarketQuery): Promise<MarketPage> {
  const cfgs = await marketConfigs(deps);
  const now = deps.now();
  let query = listingsQuery(deps.db).where('m.status', '=', 'active').where('m.expires_at', '>', now)
    // Sellers banned right now are hidden (a banned trader is not paid; M5c-1 review).
    .where((eb) => eb.or([eb('s.banned_until', 'is', null), eb('s.banned_until', '<=', sql<Date>`now()`)]));
  if (q.tier) query = query.where('g.tier', '=', TIERS.indexOf(q.tier));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    query = query.where((eb) => eb.or([eb('g.name', 'ilike', like), eb('g.designation', 'ilike', like)]));
  }
  const { n } = await query.clearSelect().select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
  query =
    q.sort === 'cheap'
      ? query.orderBy('m.price', 'asc').orderBy('m.id')
      : q.sort === 'dear'
        ? query.orderBy('m.price', 'desc').orderBy('m.id')
        : query.orderBy('m.listed_at', 'desc').orderBy('m.id');
  const rows = await query.limit(PAGE).offset((q.page - 1) * PAGE).execute();
  return { listings: rows.map(listingOf), page: q.page, pages: Math.max(1, Math.ceil(n / PAGE)), rules: await rulesFor(deps.db, accountId, cfgs, now) };
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
