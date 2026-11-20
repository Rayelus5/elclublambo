import {
  ADMIN_DEALS_PAGE_SIZE,
  type AdminAlertRow,
  type AdminAlertsPage,
  type AdminDealsPage,
  type AdminDealsQuery,
  type AdminListingRow,
  type AdminTradeRow,
  type DealGalaxy,
  type DealLineage,
  type DealReversal,
  type GalaxyLineage,
  type LaterMove,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { credit, debit } from '../economy/wallet';
import { HttpError } from '../errors';
import { type Hold, releaseHolds } from '../market/escrow';
import { confirmPassword, guardTarget } from './players';

// Trade moderation (GDD §16.2, §16.4; M6c-2), for admins: the history of listings and trades, cancelling what is
// still open, reverting a sale or a done trade, and reviewing the suspicious-trade alerts. History is never rewritten:
// a reverted deal keeps its status and gains a `deal_reversals` row, the galaxies go back and the coins move as
// compensating ledger entries. A deal goes back only when every galaxy it moved is still with its receiver, alive and
// never moved since (a later deal that was itself reverted does not count): its lineage says so and why.

export type AdminMarketDeps = { db: Kysely<DB>; now: () => Date };

const iso = (d: Date | string) => new Date(d).toISOString();
const pages = (n: number) => Math.max(1, Math.ceil(n / ADMIN_DEALS_PAGE_SIZE));
const offset = (page: number) => (page - 1) * ADMIN_DEALS_PAGE_SIZE;

async function accountId(db: Kysely<DB>, username: string): Promise<string | null> {
  const a = await db.selectFrom('galaxy.accounts').select('id').where(sql<string>`lower(username)`, '=', username.toLowerCase()).executeTakeFirst();
  return a?.id ?? null;
}

async function nameOf(db: Kysely<DB>, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await db.selectFrom('galaxy.accounts').select('username').where('id', '=', id).executeTakeFirst())?.username ?? null;
}

/**
 * The panel's rule for whom an admin may act on (M6a `guardTarget`), for every party of a deal: never themselves (no
 * reverting one's own purchase), never a superadmin, and other staff only as a superadmin.
 */
async function guardParties(db: Kysely<DB>, s: SessionInfo, ids: (string | null)[]): Promise<void> {
  for (const id of ids) {
    const name = await nameOf(db, id);
    if (name) await guardTarget(db, s, name, { self: false });
  }
}

const reversalOf = (r: { r_at: Date | null; r_by: string | null; r_reason: string | null; r_details: unknown }, withShortfall: boolean): DealReversal | null => {
  if (!r.r_at) return null;
  const details = (r.r_details ?? {}) as { shortfall?: number };
  return { at: iso(r.r_at), by: r.r_by, reason: r.r_reason ?? '', ...(withShortfall ? { shortfall: Number(details.shortfall ?? 0) } : {}) };
};

/** The history, 50 a page, the newest first; `user` is either side; an active or open one past its time reads as expired. */
export async function adminDeals(db: Kysely<DB>, q: AdminDealsQuery): Promise<AdminDealsPage> {
  const user = q.user ? await accountId(db, q.user) : undefined;
  if (q.kind === 'listings') {
    let base = db
      .selectFrom('galaxy.market_listings as l')
      .innerJoin('galaxy.galaxies as g', 'g.id', 'l.galaxy_id')
      .innerJoin('galaxy.accounts as s', 's.id', 'l.seller_id')
      .leftJoin('galaxy.accounts as b', 'b.id', 'l.buyer_id')
      .leftJoin('galaxy.deal_reversals as r', 'r.listing_id', 'l.id')
      .leftJoin('galaxy.accounts as rb', 'rb.id', 'r.by_id');
    if (user === null) return { kind: 'listings', rows: [], page: q.page, pages: 1 };
    if (user) base = base.where((eb) => eb.or([eb('l.seller_id', '=', user), eb('l.buyer_id', '=', user)]));
    if (q.status === 'active') base = base.where('l.status', '=', 'active').where('l.expires_at', '>', sql<Date>`now()`);
    else if (q.status === 'expired') base = base.where((eb) => eb.or([eb('l.status', '=', 'expired'), eb.and([eb('l.status', '=', 'active'), eb('l.expires_at', '<=', sql<Date>`now()`)])]));
    else if (q.status) base = base.where('l.status', '=', q.status);
    const { n } = await base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
    const rows = await base
      .select([
        'l.id',
        'l.price',
        'l.commission',
        'l.status',
        'l.listed_at',
        'l.sold_at',
        'l.expires_at',
        'g.id as g_id',
        'g.name as g_name',
        'g.tier as g_tier',
        's.username as seller',
        'b.username as buyer',
        'r.created_at as r_at',
        'rb.username as r_by',
        'r.reason as r_reason',
        'r.details as r_details',
      ])
      .orderBy('l.listed_at', 'desc')
      .orderBy('l.id', 'desc')
      .limit(ADMIN_DEALS_PAGE_SIZE)
      .offset(offset(q.page))
      .execute();
    const out: AdminListingRow[] = rows.map((r) => ({
      id: r.id,
      galaxy: { id: r.g_id, name: r.g_name, tier: r.g_tier },
      seller: r.seller,
      buyer: r.buyer ?? null,
      price: Number(r.price),
      commission: r.commission === null ? null : Number(r.commission),
      status: r.status === 'active' && new Date(r.expires_at) <= new Date() ? 'expired' : r.status,
      listedAt: iso(r.listed_at),
      soldAt: r.sold_at ? iso(r.sold_at) : null,
      reversal: reversalOf(r, true),
    }));
    return { kind: 'listings', rows: out, page: q.page, pages: pages(n) };
  }
  let base = db
    .selectFrom('galaxy.trades as t')
    .innerJoin('galaxy.accounts as a', 'a.id', 't.a_id')
    .innerJoin('galaxy.accounts as b', 'b.id', 't.b_id')
    .leftJoin('galaxy.deal_reversals as r', 'r.trade_id', 't.id')
    .leftJoin('galaxy.accounts as rb', 'rb.id', 'r.by_id');
  if (user === null) return { kind: 'trades', rows: [], page: q.page, pages: 1 };
  if (user) base = base.where((eb) => eb.or([eb('t.a_id', '=', user), eb('t.b_id', '=', user)]));
  if (q.status === 'open') base = base.where('t.status', '=', 'open').where('t.expires_at', '>', sql<Date>`now()`);
  else if (q.status === 'expired') base = base.where((eb) => eb.or([eb('t.status', '=', 'expired'), eb.and([eb('t.status', '=', 'open'), eb('t.expires_at', '<=', sql<Date>`now()`)])]));
  else if (q.status) base = base.where('t.status', '=', q.status);
  const { n } = await base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
  const rows = await base
    .select([
      't.id',
      't.status',
      't.created_at',
      't.closed_at',
      't.expires_at',
      'a.username as a',
      'b.username as b',
      't.a_coins',
      't.b_coins',
      'r.created_at as r_at',
      'rb.username as r_by',
      'r.reason as r_reason',
      'r.details as r_details',
    ])
    .orderBy('t.created_at', 'desc')
    .orderBy('t.id', 'desc')
    .limit(ADMIN_DEALS_PAGE_SIZE)
    .offset(offset(q.page))
    .execute();
  // What each side gives, for the page's trades at once (trades 2.0: several galaxies a side).
  const items = rows.length
    ? await db
        .selectFrom('galaxy.trade_items as i')
        .innerJoin('galaxy.galaxies as g', 'g.id', 'i.galaxy_id')
        .select(['i.trade_id', 'i.side', 'g.id', 'g.name', 'g.tier'])
        .where(
          'i.trade_id',
          'in',
          rows.map((r) => r.id),
        )
        .orderBy('g.tier', 'desc')
        .orderBy('g.name')
        .execute()
    : [];
  const gives = (trade: string, side: 'a' | 'b'): DealGalaxy[] => items.filter((i) => i.trade_id === trade && i.side === side).map((i) => ({ id: i.id, name: i.name, tier: i.tier }));
  const out: AdminTradeRow[] = rows.map((r) => ({
    id: r.id,
    a: r.a,
    b: r.b,
    aGalaxies: gives(r.id, 'a'),
    bGalaxies: gives(r.id, 'b'),
    aCoins: Number(r.a_coins),
    bCoins: Number(r.b_coins),
    status: r.status === 'open' && new Date(r.expires_at) <= new Date() ? 'expired' : r.status,
    createdAt: iso(r.created_at),
    closedAt: r.closed_at ? iso(r.closed_at) : null,
    reversal: reversalOf(r, false),
  }));
  return { kind: 'trades', rows: out, page: q.page, pages: pages(n) };
}

/** Withdraws an active listing (the seller may list again), audited. 409 when it sold, expired or was withdrawn. */
export async function adminCancelListing(deps: AdminMarketDeps, actor: AuditActor, s: SessionInfo, id: string, reason: string): Promise<{ cancelled: true }> {
  const party = await deps.db.selectFrom('galaxy.market_listings').select('seller_id').where('id', '=', id).executeTakeFirst();
  await guardParties(deps.db, s, [party?.seller_id ?? null]);
  return inTransaction(deps.db, async (trx) => {
    const l = await trx.selectFrom('galaxy.market_listings').select(['status', 'expires_at', 'seller_id', 'price', 'galaxy_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!l || l.status !== 'active' || new Date(l.expires_at) <= deps.now()) throw new HttpError(409, 'listing_gone');
    await trx.updateTable('galaxy.market_listings').set({ status: 'cancelled' }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'market.cancel', targetType: 'listing', targetId: id, before: { status: 'active', seller: await nameOf(trx, l.seller_id), price: Number(l.price), galaxy: l.galaxy_id }, reason });
    return { cancelled: true };
  });
}

/** Cancels an open trade (what was offered is free again), audited. 409 when it closed or expired. */
export async function adminCancelTrade(deps: AdminMarketDeps, actor: AuditActor, s: SessionInfo, id: string, reason: string): Promise<{ cancelled: true }> {
  const parties = await deps.db.selectFrom('galaxy.trades').select(['a_id', 'b_id']).where('id', '=', id).executeTakeFirst();
  await guardParties(deps.db, s, [parties?.a_id ?? null, parties?.b_id ?? null]);
  return inTransaction(deps.db, async (trx) => {
    const t = await trx.selectFrom('galaxy.trades').select(['status', 'expires_at', 'a_id', 'b_id']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!t || t.status !== 'open' || new Date(t.expires_at) <= deps.now()) throw new HttpError(409, 'trade_gone');
    await trx.updateTable('galaxy.trades').set({ status: 'cancelled', closed_at: deps.now() }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'trade.cancel', targetType: 'trade', targetId: id, before: { status: 'open', a: await nameOf(trx, t.a_id), b: await nameOf(trx, t.b_id) }, reason });
    return { cancelled: true };
  });
}

type Move = { galaxy: string; fromId: string; toId: string; at: Date };

/** What a deal moved: a sale moved one galaxy from the seller to the buyer; a done trade, each side's to the other. */
async function movesOf(db: Kysely<DB>, kind: 'listing' | 'trade', id: string): Promise<Move[]> {
  if (kind === 'listing') {
    const l = await db.selectFrom('galaxy.market_listings').select(['status', 'galaxy_id', 'seller_id', 'buyer_id', 'sold_at']).where('id', '=', id).executeTakeFirst();
    if (!l || l.status !== 'sold' || !l.buyer_id || !l.sold_at) throw new HttpError(409, 'listing_gone');
    return [{ galaxy: l.galaxy_id, fromId: l.seller_id, toId: l.buyer_id, at: new Date(l.sold_at) }];
  }
  const t = await db.selectFrom('galaxy.trades').select(['status', 'a_id', 'b_id', 'closed_at']).where('id', '=', id).executeTakeFirst();
  if (!t || t.status !== 'done' || !t.closed_at) throw new HttpError(409, 'trade_gone');
  const at = new Date(t.closed_at);
  const items = await db.selectFrom('galaxy.trade_items').select(['side', 'galaxy_id']).where('trade_id', '=', id).orderBy('galaxy_id').execute();
  return items.map((i) => (i.side === 'a' ? { galaxy: i.galaxy_id, fromId: t.a_id, toId: t.b_id, at } : { galaxy: i.galaxy_id, fromId: t.b_id, toId: t.a_id, at }));
}

async function galaxyLineage(db: Kysely<DB>, m: Move, deal: string): Promise<GalaxyLineage> {
  const g = await db.selectFrom('galaxy.galaxies').select(['id', 'name', 'tier', 'owner_id', 'disintegrated_at']).where('id', '=', m.galaxy).executeTakeFirstOrThrow();
  const child = await db
    .selectFrom('galaxy.galaxies as c')
    .innerJoin('galaxy.accounts as o', 'o.id', 'c.owner_id')
    .select(['c.id', 'c.name', 'c.tier', 'o.username'])
    .where(sql<boolean>`c.lineage @> array[${m.galaxy}]::uuid[]`)
    .executeTakeFirst();
  // Later deals of this galaxy that stand (one reverted since no longer moved it).
  const sales = await db
    .selectFrom('galaxy.market_listings as l')
    .innerJoin('galaxy.accounts as s', 's.id', 'l.seller_id')
    .innerJoin('galaxy.accounts as b', 'b.id', 'l.buyer_id')
    .leftJoin('galaxy.deal_reversals as r', 'r.listing_id', 'l.id')
    .select(['l.id', 'l.sold_at', 's.username as from', 'b.username as to'])
    .where('l.galaxy_id', '=', m.galaxy)
    .where('l.status', '=', 'sold')
    .where('l.sold_at', '>', m.at)
    .where('l.id', '!=', deal)
    .where('r.id', 'is', null)
    .execute();
  const trades = await db
    .selectFrom('galaxy.trades as t')
    .innerJoin('galaxy.accounts as a', 'a.id', 't.a_id')
    .innerJoin('galaxy.accounts as b', 'b.id', 't.b_id')
    .innerJoin('galaxy.trade_items as i', 'i.trade_id', 't.id')
    .leftJoin('galaxy.deal_reversals as r', 'r.trade_id', 't.id')
    .select(['t.id', 't.closed_at', 'i.side', 'a.username as a', 'b.username as b'])
    .where('t.status', '=', 'done')
    .where('t.closed_at', '>', m.at)
    .where('t.id', '!=', deal)
    .where('i.galaxy_id', '=', m.galaxy)
    .where('r.id', 'is', null)
    .execute();
  const laterMoves: LaterMove[] = [
    ...sales.map((s) => ({ kind: 'sale' as const, id: s.id, at: iso(s.sold_at!), from: s.from, to: s.to })),
    ...trades.map((t) => ({ kind: 'trade' as const, id: t.id, at: iso(t.closed_at!), from: t.side === 'a' ? t.a : t.b, to: t.side === 'a' ? t.b : t.a })),
  ].sort((x, y) => x.at.localeCompare(y.at));
  // Dust spent on its levels since the deal: reverting would hand it to the other side, so it blocks (the admin settles
  // it by hand).
  const { spent } = await db
    .selectFrom('galaxy.ledger')
    .select(sql<number>`coalesce(-sum(delta), 0)::int`.as('spent'))
    .where('reason', '=', 'relic_level')
    .where(sql<string>`ref->>'galaxy'`, '=', m.galaxy)
    .where('created_at', '>', m.at)
    .executeTakeFirstOrThrow();
  const gone = g.disintegrated_at !== null;
  return {
    galaxy: { id: g.id, name: g.name, tier: g.tier },
    from: (await nameOf(db, m.fromId)) ?? '',
    to: (await nameOf(db, m.toId)) ?? '',
    owner: gone ? null : await nameOf(db, g.owner_id),
    gone,
    fusedInto: child ? { galaxy: { id: child.id, name: child.name, tier: child.tier }, owner: child.username } : null,
    laterMoves,
    leveledSince: spent,
    returnable: !gone && g.owner_id === m.toId && laterMoves.length === 0 && spent === 0,
  };
}

async function reversalRow(db: Kysely<DB>, kind: 'listing' | 'trade', id: string): Promise<DealReversal | null> {
  const r = await db
    .selectFrom('galaxy.deal_reversals as r')
    .leftJoin('galaxy.accounts as rb', 'rb.id', 'r.by_id')
    .select(['r.created_at as r_at', 'rb.username as r_by', 'r.reason as r_reason', 'r.details as r_details'])
    .where(kind === 'listing' ? 'r.listing_id' : 'r.trade_id', '=', id)
    .executeTakeFirst();
  return r ? reversalOf(r, kind === 'listing') : null;
}

/** Where each galaxy a deal moved is now, and whether the deal can be reverted. */
export async function dealLineage(db: Kysely<DB>, kind: 'listing' | 'trade', id: string): Promise<DealLineage> {
  const galaxies = await Promise.all((await movesOf(db, kind, id)).map((m) => galaxyLineage(db, m, id)));
  const reversal = await reversalRow(db, kind, id);
  const money = kind === 'listing' ? await saleMoney(db, id) : await tradeMoney(db, id);
  return { galaxies, returnable: reversal === null && galaxies.every((g) => g.returnable), reversal, ...(money ? { money } : {}) };
}

/** What reverting a sale moves: the whole price back to the buyer, and what the seller received, as far as their coins reach. */
async function saleMoney(db: Kysely<DB>, id: string): Promise<{ price: number; owed: number; recoverable: number }> {
  const l = await db.selectFrom('galaxy.market_listings').select(['seller_id', 'price', 'commission']).where('id', '=', id).executeTakeFirstOrThrow();
  const bal = await db.selectFrom('galaxy.balances').select('amount').where('account_id', '=', l.seller_id).where('currency', '=', 'coins').executeTakeFirst();
  const price = Number(l.price);
  const owed = price - Number(l.commission ?? 0);
  return { price, owed, recoverable: Math.min(owed, Number(bal?.amount ?? 0)) };
}

/**
 * What reverting a trade with coins moves (trades 2.0): the coins back to who paid them, and what the other side
 * received (less the commission) taken back as far as their coins reach. Nothing for a trade without coins.
 */
async function tradeMoney(db: Kysely<DB>, id: string): Promise<{ price: number; owed: number; recoverable: number } | undefined> {
  const t = await db.selectFrom('galaxy.trades').select(['a_id', 'b_id', 'a_coins', 'b_coins', 'commission']).where('id', '=', id).executeTakeFirst();
  if (!t) return undefined;
  const price = Number(t.a_coins) || Number(t.b_coins);
  if (price === 0) return undefined;
  const receiver = Number(t.a_coins) > 0 ? t.b_id : t.a_id;
  const bal = await db.selectFrom('galaxy.balances').select('amount').where('account_id', '=', receiver).where('currency', '=', 'coins').executeTakeFirst();
  const owed = price - Number(t.commission ?? 0);
  return { price, owed, recoverable: Math.min(owed, Number(bal?.amount ?? 0)) };
}

/** Under the deal's lock: not reverted yet, and every galaxy (locked in id order) able to go back; else 409. */
async function revertable(trx: Kysely<DB>, kind: 'listing' | 'trade', id: string): Promise<DealLineage> {
  if (await reversalRow(trx, kind, id)) throw new HttpError(409, 'already_reverted');
  const ids = (await movesOf(trx, kind, id)).map((m) => m.galaxy).sort();
  await trx.selectFrom('galaxy.galaxies').select('id').where('id', 'in', ids).orderBy('id').forUpdate().execute();
  const lineage = await dealLineage(trx, kind, id);
  if (!lineage.returnable) throw new HttpError(409, 'revert_blocked', { lineage });
  return lineage;
}

/**
 * Reverts a sale: the galaxy back to the seller (freed from any hold its buyer put it in), the whole price back to the
 * buyer, and what the seller received (price minus commission) taken back as far as their coins reach; the shortfall is
 * recorded, a balance never goes below 0. Once per sale, with the admin's password.
 */
export async function revertSale(deps: AdminMarketDeps, actor: AuditActor, s: SessionInfo, id: string, reason: string, password: string): Promise<{ reverted: true; shortfall: number }> {
  const parties = await deps.db.selectFrom('galaxy.market_listings').select(['seller_id', 'buyer_id']).where('id', '=', id).executeTakeFirst();
  await guardParties(deps.db, s, [parties?.seller_id ?? null, parties?.buyer_id ?? null]);
  await confirmPassword(deps.db, s, password);
  return inTransaction(deps.db, async (trx) => {
    const l = await trx.selectFrom('galaxy.market_listings').select(['status', 'galaxy_id', 'seller_id', 'buyer_id', 'price', 'commission']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!l || l.status !== 'sold' || !l.buyer_id) throw new HttpError(409, 'listing_gone');
    await revertable(trx, 'listing', id);
    const held = await releaseHolds(trx, l.galaxy_id);
    await trx.updateTable('galaxy.galaxies').set({ owner_id: l.seller_id, locked: false }).where('id', '=', l.galaxy_id).execute();
    const price = Number(l.price);
    const owed = price - Number(l.commission ?? 0);
    const ref = { listing: id, galaxy: l.galaxy_id };
    await credit(trx, l.buyer_id, 'coins', price, 'market_revert', ref, `revert:${id}:buyer`);
    const bal = await trx.selectFrom('galaxy.balances').select('amount').where('account_id', '=', l.seller_id).where('currency', '=', 'coins').forUpdate().executeTakeFirst();
    const recovered = Math.min(owed, Number(bal?.amount ?? 0));
    if (recovered > 0) await debit(trx, l.seller_id, 'coins', recovered, 'market_revert', ref, `revert:${id}:seller`);
    const shortfall = owed - recovered;
    await trx
      .insertInto('galaxy.deal_reversals')
      .values({ listing_id: id, by_id: actor.id, reason, details: JSON.stringify({ shortfall, refunded: price, recovered, held }) })
      .execute();
    const [seller, buyer] = [await nameOf(trx, l.seller_id), await nameOf(trx, l.buyer_id)];
    await writeAudit(trx, {
      actor,
      action: 'market.revert',
      targetType: 'listing',
      targetId: id,
      before: { owner: buyer, held },
      after: { galaxy: l.galaxy_id, to: seller, refunded: price, recovered, shortfall },
      reason,
    });
    return { reverted: true, shortfall };
  });
}

/**
 * Reverts a done trade: each galaxy back to who gave it, freed from any hold; coins that changed hands back to who paid
 * them, and what the other side received taken back as far as their coins reach (the shortfall recorded, as a sale's).
 * Once per trade, with the password.
 */
export async function revertTrade(deps: AdminMarketDeps, actor: AuditActor, s: SessionInfo, id: string, reason: string, password: string): Promise<{ reverted: true }> {
  const parties = await deps.db.selectFrom('galaxy.trades').select(['a_id', 'b_id']).where('id', '=', id).executeTakeFirst();
  await guardParties(deps.db, s, [parties?.a_id ?? null, parties?.b_id ?? null]);
  await confirmPassword(deps.db, s, password);
  return inTransaction(deps.db, async (trx) => {
    const t = await trx.selectFrom('galaxy.trades').select(['status', 'a_id', 'b_id', 'a_coins', 'b_coins', 'commission']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!t || t.status !== 'done') throw new HttpError(409, 'trade_gone');
    await revertable(trx, 'trade', id);
    const items = await trx.selectFrom('galaxy.trade_items').select(['side', 'galaxy_id']).where('trade_id', '=', id).orderBy('galaxy_id').execute();
    const held: Record<string, Hold[]> = {};
    for (const i of items) held[i.galaxy_id] = await releaseHolds(trx, i.galaxy_id);
    const giverOf = (side: 'a' | 'b') => (side === 'a' ? t.a_id : t.b_id);
    for (const side of ['a', 'b'] as const) {
      const ids = items.filter((i) => i.side === side).map((i) => i.galaxy_id);
      if (ids.length) await trx.updateTable('galaxy.galaxies').set({ owner_id: giverOf(side), locked: false }).where('id', 'in', ids).execute();
    }
    // The coins, when there were: back to who paid them, taken back from who got them as far as their coins reach.
    const price = Number(t.a_coins) || Number(t.b_coins);
    let money: { refunded: number; recovered: number; shortfall: number } | null = null;
    if (price > 0) {
      const [payer, receiver] = Number(t.a_coins) > 0 ? [t.a_id, t.b_id] : [t.b_id, t.a_id];
      const ref = { trade: id };
      await credit(trx, payer, 'coins', price, 'trade_revert', ref, `revert:${id}:payer`);
      const owed = price - Number(t.commission ?? 0);
      const bal = await trx.selectFrom('galaxy.balances').select('amount').where('account_id', '=', receiver).where('currency', '=', 'coins').forUpdate().executeTakeFirst();
      const recovered = Math.min(owed, Number(bal?.amount ?? 0));
      if (recovered > 0) await debit(trx, receiver, 'coins', recovered, 'trade_revert', ref, `revert:${id}:receiver`);
      money = { refunded: price, recovered, shortfall: owed - recovered };
    }
    await trx
      .insertInto('galaxy.deal_reversals')
      .values({ trade_id: id, by_id: actor.id, reason, details: JSON.stringify({ held, ...(money ?? {}) }) })
      .execute();
    const [a, b] = [await nameOf(trx, t.a_id), await nameOf(trx, t.b_id)];
    const back = Object.fromEntries(items.map((i) => [i.galaxy_id, i.side === 'a' ? a : b]));
    await writeAudit(trx, { actor, action: 'trade.revert', targetType: 'trade', targetId: id, before: { held }, after: { ...back, ...(money ?? {}) }, reason });
    return { reverted: true };
  });
}

/** The alerts, the newest first, 50 a page; pending ones only, reviewed ones only, or all. */
export async function adminAlerts(db: Kysely<DB>, q: { reviewed?: boolean; page: number }): Promise<AdminAlertsPage> {
  let base = db
    .selectFrom('galaxy.trade_alerts as a')
    .leftJoin('galaxy.accounts as s', 's.id', 'a.seller_id')
    .leftJoin('galaxy.accounts as b', 'b.id', 'a.buyer_id')
    .leftJoin('galaxy.accounts as rv', 'rv.id', 'a.reviewed_by');
  if (q.reviewed === true) base = base.where('a.reviewed_at', 'is not', null);
  if (q.reviewed === false) base = base.where('a.reviewed_at', 'is', null);
  const { n } = await base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
  const rows = await base
    .select(['a.id', 'a.kind', 'a.listing_id', 'a.trade_id', 'a.details', 'a.created_at', 'a.reviewed_at', 'a.review_reason', 's.username as seller', 'b.username as buyer', 'rv.username as reviewer'])
    .orderBy('a.created_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(ADMIN_DEALS_PAGE_SIZE)
    .offset(offset(q.page))
    .execute();
  const out: AdminAlertRow[] = rows.map((r) => ({
    id: String(r.id),
    kind: r.kind,
    deal: r.listing_id ? { kind: 'listing', id: r.listing_id } : r.trade_id ? { kind: 'trade', id: r.trade_id } : null,
    seller: r.seller ?? null,
    buyer: r.buyer ?? null,
    details: (r.details ?? {}) as Record<string, unknown>,
    at: iso(r.created_at),
    review: r.reviewed_at ? { at: iso(r.reviewed_at), by: r.reviewer ?? null, reason: r.review_reason ?? '' } : null,
  }));
  return { rows: out, page: q.page, pages: pages(n) };
}

/** Marks an alert reviewed with a reason, once, audited. */
export async function reviewAlert(deps: AdminMarketDeps, actor: AuditActor, s: SessionInfo, id: string, reason: string): Promise<{ reviewed: true }> {
  const parties = await deps.db.selectFrom('galaxy.trade_alerts').select(['seller_id', 'buyer_id']).where('id', '=', id).executeTakeFirst();
  await guardParties(deps.db, s, [parties?.seller_id ?? null, parties?.buyer_id ?? null]);
  return inTransaction(deps.db, async (trx) => {
    const a = await trx.selectFrom('galaxy.trade_alerts').select(['kind', 'reviewed_at']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!a) throw new HttpError(404, 'not_found');
    if (a.reviewed_at) throw new HttpError(409, 'alert_reviewed');
    await trx.updateTable('galaxy.trade_alerts').set({ reviewed_at: deps.now(), reviewed_by: actor.id, review_reason: reason }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'alert.review', targetType: 'alert', targetId: id, before: { kind: a.kind }, reason });
    return { reviewed: true };
  });
}
