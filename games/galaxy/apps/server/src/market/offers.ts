import { commissionOf, type MarketOffer, type MarketOffersView, minPriceFor, type OfferStatus, TIERS } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { summary } from '../collection/service';
import type { DB } from '../db/schema';
import { credit, debit } from '../economy/wallet';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { type Notices, noticePlayer } from '../realtime/notices';
import { isEquipped, isExhibited, isTraded } from './escrow';
import { lockTrader, type MarketConfigs, refuse, rulesFor, todayStart } from './service';

// Offers on market listings (the owner, 2026-11-14: «ofertas en los anuncios … se reserva» the gold). Making one holds
// the buyer's coins (a ledger line and a `coin_holds` row); it lasts `market.offers.hours` (never past its listing).
// Each listing row is locked first in every change of its offers, so two never race. The seller accepts one (the sale
// closes at once, at that amount, and the galaxy changes hands) or rejects it; the buyer withdraws it or raises it (a
// new one, higher). A listing full of offers takes a new one only above its lowest, which is outbid. Whatever ends an
// offer without a sale gives its coins back (galaxy.release_hold); a listing that stops being on sale closes its open
// offers in the database itself (20261114140000_galaxy_market_offers), whatever ended it.

const DAY_MS = 86_400_000;

/** Gives a hold back (its ledger line included); false when it was not held any more. */
export async function releaseHold(trx: Kysely<DB>, hold: string, reason: string, ref: object): Promise<boolean> {
  const { rows } = await sql<{ ok: boolean }>`select galaxy.release_hold(${hold}::uuid, ${reason}, ${JSON.stringify(ref)}::jsonb) as ok`.execute(trx);
  return rows[0]?.ok === true;
}

/** Ends an open offer with `status` and gives its coins back; false when it was not open any more. */
async function endOffer(trx: Kysely<DB>, id: string, status: Exclude<OfferStatus, 'open' | 'accepted'>, now: Date): Promise<{ hold: string; buyer: string; amount: number } | null> {
  const row = await trx
    .updateTable('galaxy.market_offers')
    .set({ status, closed_at: now })
    .where('id', '=', id)
    .where('status', '=', 'open')
    .returning(['hold_id', 'buyer_id', 'amount', 'listing_id'])
    .executeTakeFirst();
  if (!row) return null;
  await releaseHold(trx, row.hold_id, 'market_offer_release', { offer: id, listing: row.listing_id, status });
  return { hold: row.hold_id, buyer: row.buyer_id, amount: Number(row.amount) };
}

/**
 * Ends every open offer an account made, as `closed`, its coins back: a ban or a deletion (their own listings close
 * theirs through the listing trigger). At most `market.offers.open` of them, so one by one.
 */
export async function closeOffersOf(trx: Kysely<DB>, buyerId: string, now: Date): Promise<number> {
  const open = await trx.selectFrom('galaxy.market_offers').select('id').where('buyer_id', '=', buyerId).where('status', '=', 'open').orderBy('id').execute();
  let closed = 0;
  for (const o of open) if (await endOffer(trx, o.id, 'closed', now)) closed++;
  return closed;
}

/** A listing on sale now, locked for its offers' change (409 listing_gone when it is not). */
async function lockListing(trx: Kysely<DB>, id: string, now: Date) {
  const l = await trx
    .selectFrom('galaxy.market_listings as m')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'm.galaxy_id')
    .select(['m.id', 'm.galaxy_id', 'm.seller_id', 'm.price', 'm.status', 'm.expires_at', 'g.tier', 'g.name'])
    .where('m.id', '=', id)
    .forUpdate('m')
    .executeTakeFirst();
  if (!l || l.status !== 'active' || new Date(l.expires_at) <= now) throw new HttpError(409, 'listing_gone');
  return l;
}

const galaxyOf = (l: { galaxy_id: string; name: string; tier: number }) => ({ id: l.galaxy_id, name: l.name, tier: TIERS[l.tier]! });

/**
 * Makes an offer on a listing, or raises one's own (the old one withdrawn, its coins back first): at least its
 * rarity's floor, below its price, within one's open and daily offers; on a full listing, above its lowest (which is
 * outbid). The coins are held now.
 */
export async function makeOffer(cfgs: MarketConfigs, trx: Kysely<DB>, buyerId: string, listingId: string, amount: number, now: Date, opKey: string, out?: Notices): Promise<{ id: string; amount: number; expiresAt: string }> {
  const cfg = cfgs.market.offers;
  await lockTrader(trx, buyerId);
  refuse(await rulesFor(trx, buyerId, cfgs, now));
  const l = await lockListing(trx, listingId, now);
  if (l.seller_id === buyerId) throw new HttpError(409, 'own_listing');
  const seller = await trx.selectFrom('galaxy.accounts').select('banned_until').where('id', '=', l.seller_id).executeTakeFirst();
  if (!seller || (seller.banned_until && new Date(seller.banned_until) > now)) throw new HttpError(409, 'listing_gone');
  if (amount < minPriceFor(TIERS[l.tier]!, cfgs.market)) throw new HttpError(400, 'offer_too_low');
  if (amount >= Number(l.price)) throw new HttpError(400, 'offer_too_high');
  const mine = await trx.selectFrom('galaxy.market_offers').select(['id', 'amount']).where('listing_id', '=', l.id).where('buyer_id', '=', buyerId).where('status', '=', 'open').executeTakeFirst();
  if (mine && amount <= Number(mine.amount)) throw new HttpError(400, 'offer_not_higher');
  const [open, today] = await Promise.all([
    trx.selectFrom('galaxy.market_offers').select(sql<number>`count(*)::int`.as('n')).where('buyer_id', '=', buyerId).where('status', '=', 'open').executeTakeFirstOrThrow(),
    trx.selectFrom('galaxy.market_offers').select(sql<number>`count(*)::int`.as('n')).where('buyer_id', '=', buyerId).where('created_at', '>=', todayStart(now)).executeTakeFirstOrThrow(),
  ]);
  if (open.n - (mine ? 1 : 0) >= cfg.open || today.n >= cfg.perDay) throw new HttpError(429, 'offer_limit');
  // A full listing: the new one has to beat its lowest, which is outbid (not counting one's own, which is replaced).
  const others = await trx
    .selectFrom('galaxy.market_offers')
    .select(['id', 'amount', 'buyer_id'])
    .where('listing_id', '=', l.id)
    .where('status', '=', 'open')
    .where('buyer_id', '<>', buyerId)
    .orderBy('amount')
    .orderBy('created_at', 'desc')
    .execute();
  let outbid: (typeof others)[number] | null = null;
  if (others.length >= cfg.perListing) {
    outbid = others[0]!;
    if (amount <= Number(outbid.amount)) throw new HttpError(409, 'offer_beaten');
  }
  if (mine) await endOffer(trx, mine.id, 'withdrawn', now);
  if (outbid && (await endOffer(trx, outbid.id, 'outbid', now))) {
    out?.add(outbid.buyer_id, { kind: 'offer', event: 'outbid', offer: outbid.id, galaxy: galaxyOf(l), amount: Number(outbid.amount), from: null });
  }
  const hold = await trx.insertInto('galaxy.coin_holds').values({ account_id: buyerId, amount, kind: 'offer' }).returning('id').executeTakeFirstOrThrow();
  await debit(trx, buyerId, 'coins', amount, 'market_offer_hold', { listing: l.id, hold: hold.id }, opKey);
  const expiresAt = new Date(Math.min(now.getTime() + cfg.hours * 3_600_000, new Date(l.expires_at).getTime()));
  const offer = await trx
    .insertInto('galaxy.market_offers')
    .values({ listing_id: l.id, buyer_id: buyerId, amount, hold_id: hold.id, expires_at: expiresAt })
    .returning('id')
    .executeTakeFirstOrThrow();
  out?.add(l.seller_id, { kind: 'offer', event: 'received', offer: offer.id, galaxy: galaxyOf(l), amount, from: await noticePlayer(trx, buyerId) });
  return { id: offer.id, amount, expiresAt: expiresAt.toISOString() };
}

/** An open offer and its listing (locked first); 404 offer_gone when it is not open any more. */
async function openOffer(trx: Kysely<DB>, id: string, now: Date) {
  const o = await trx.selectFrom('galaxy.market_offers').select(['id', 'listing_id', 'buyer_id', 'amount', 'hold_id', 'status', 'expires_at']).where('id', '=', id).executeTakeFirst();
  if (!o) throw new HttpError(404, 'offer_gone');
  const l = await lockListing(trx, o.listing_id, now);
  const fresh = await trx.selectFrom('galaxy.market_offers').select(['status', 'expires_at']).where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
  if (fresh.status !== 'open' || new Date(fresh.expires_at) <= now) throw new HttpError(409, 'offer_gone');
  return { o, l };
}

/** The buyer takes their offer back (its coins return). */
export async function withdrawOffer(trx: Kysely<DB>, buyerId: string, id: string, now: Date): Promise<{ withdrawn: true }> {
  const o = await trx.selectFrom('galaxy.market_offers').select(['buyer_id']).where('id', '=', id).executeTakeFirst();
  if (!o || o.buyer_id !== buyerId) throw new HttpError(404, 'offer_gone');
  if (!(await endOffer(trx, id, 'withdrawn', now))) throw new HttpError(409, 'offer_gone');
  return { withdrawn: true };
}

/** The seller turns an offer down (its coins return to the buyer, who hears it). */
export async function rejectOffer(trx: Kysely<DB>, sellerId: string, id: string, now: Date, out?: Notices): Promise<{ rejected: true }> {
  const { o, l } = await openOffer(trx, id, now);
  if (l.seller_id !== sellerId) throw new HttpError(404, 'offer_gone');
  await endOffer(trx, id, 'rejected', now);
  out?.add(o.buyer_id, { kind: 'offer', event: 'rejected', offer: id, galaxy: galaxyOf(l), amount: Number(o.amount), from: await noticePlayer(trx, sellerId) });
  return { rejected: true };
}

/**
 * The seller accepts an offer: the sale closes at once at its amount (the held coins pay it; the seller gets it less the
 * commission), the galaxy is the buyer's, and the listing's other offers close with their coins back (the database
 * does it as the listing leaves sale). It counts as a purchase of the buyer's day.
 */
export async function acceptOffer(cfgs: MarketConfigs, trx: Kysely<DB>, sellerId: string, id: string, now: Date, opKey: string, out?: Notices): Promise<{ sold: true; net: number }> {
  await lockTrader(trx, sellerId);
  const { o, l } = await openOffer(trx, id, now);
  if (l.seller_id !== sellerId) throw new HttpError(404, 'offer_gone');
  const buyer = await trx.selectFrom('galaxy.accounts').select('banned_until').where('id', '=', o.buyer_id).executeTakeFirst();
  if (!buyer || (buyer.banned_until && new Date(buyer.banned_until) > now)) throw new HttpError(409, 'offer_gone');
  const g = await trx
    .selectFrom('galaxy.galaxies')
    .select(['id'])
    .where('id', '=', l.galaxy_id)
    .where('owner_id', '=', sellerId)
    .where('disintegrated_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();
  if (!g || (await isEquipped(trx, [g.id])) || (await isExhibited(trx, [g.id])) || (await isTraded(trx, [g.id]))) throw new HttpError(409, 'listing_gone');
  const amount = Number(o.amount);
  const commission = commissionOf(amount, cfgs.market.commission);
  const spent = await trx.updateTable('galaxy.coin_holds').set({ status: 'spent', closed_at: now }).where('id', '=', o.hold_id).where('status', '=', 'held').returning('id').executeTakeFirst();
  if (!spent) throw new HttpError(409, 'offer_gone');
  await trx.updateTable('galaxy.market_offers').set({ status: 'accepted', closed_at: now }).where('id', '=', id).execute();
  const others = await trx.selectFrom('galaxy.market_offers').select(['id', 'buyer_id', 'amount']).where('listing_id', '=', l.id).where('status', '=', 'open').execute();
  const ref = { listing: l.id, galaxy: g.id, offer: id };
  if (amount - commission > 0) await credit(trx, sellerId, 'coins', amount - commission, 'market_sale', ref, opKey);
  await trx.updateTable('galaxy.galaxies').set({ owner_id: o.buyer_id, locked: false }).where('id', '=', g.id).execute();
  // Sold at the offer: the listing says what it fetched (its floor still holds: an offer never goes below it).
  await trx.updateTable('galaxy.market_listings').set({ price: String(amount), status: 'sold', buyer_id: o.buyer_id, sold_at: now, commission }).where('id', '=', l.id).execute();
  out?.add(o.buyer_id, { kind: 'offer', event: 'accepted', offer: id, galaxy: galaxyOf(l), amount, from: await noticePlayer(trx, sellerId) });
  for (const x of others) out?.add(x.buyer_id, { kind: 'offer', event: 'closed', offer: x.id, galaxy: galaxyOf(l), amount: Number(x.amount), from: null });
  return { sold: true, net: amount - commission };
}

/** The offers on my listings and mine (the open ones first, then the latest; 50 of each). */
export async function myOffers(db: Kysely<DB>, accountId: string): Promise<MarketOffersView> {
  const base = () =>
    db
      .selectFrom('galaxy.market_offers as o')
      .innerJoin('galaxy.market_listings as m', 'm.id', 'o.listing_id')
      .innerJoin('galaxy.galaxies as g', 'g.id', 'm.galaxy_id')
      .innerJoin('galaxy.accounts as s', 's.id', 'm.seller_id')
      .innerJoin('galaxy.accounts as b', 'b.id', 'o.buyer_id')
      .select([
        'o.id',
        'o.amount',
        'o.status',
        'o.created_at as offered_at',
        'o.expires_at as offer_expires',
        'o.closed_at',
        'm.id as listing_id',
        'm.price',
        'm.status as listing_status',
        'm.expires_at as listing_expires',
        's.username as seller',
        'b.username as buyer',
        'g.id',
        'g.seed',
        'g.tier',
        'g.finish',
        'g.traits',
        'g.name',
        'g.designation',
        'g.featured',
        'g.level',
        'g.created_at',
        'g.score',
      ])
      .orderBy(sql`(o.status = 'open')`, 'desc')
      .orderBy('o.created_at', 'desc')
      .limit(50);
  const [received, sent, held] = await Promise.all([
    base().where('m.seller_id', '=', accountId).where((eb) => eb.or([eb('o.status', '=', 'open'), eb('o.created_at', '>', new Date(Date.now() - 7 * DAY_MS))])).execute(),
    base().where('o.buyer_id', '=', accountId).execute(),
    db.selectFrom('galaxy.coin_holds').select(sql<string>`coalesce(sum(amount), 0)`.as('n')).where('account_id', '=', accountId).where('status', '=', 'held').where('kind', '=', 'offer').executeTakeFirstOrThrow(),
  ]);
  type Row = (typeof sent)[number];
  const of = (r: Row): MarketOffer => ({
    id: r.id,
    listing: { id: r.listing_id, galaxy: summary(r), price: Number(r.price), seller: r.seller, active: r.listing_status === 'active' && new Date(r.listing_expires) > new Date() },
    buyer: r.buyer,
    amount: Number(r.amount),
    status: r.status,
    createdAt: new Date(r.offered_at).toISOString(),
    expiresAt: new Date(r.offer_expires).toISOString(),
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
  });
  return { received: received.map(of), sent: sent.map(of), held: Number(held.n) };
}

/** The offers past their time: expired, their coins back (the market's job; 500 at a time). */
export async function expireOffers(db: Kysely<DB>, batch = 500): Promise<number> {
  return inTransaction(db, async (trx) => {
    const { rows } = await sql<{ id: string; hold_id: string; listing_id: string }>`
      update galaxy.market_offers set status = 'expired', closed_at = now()
       where id in (select id from galaxy.market_offers where status = 'open' and expires_at <= now() order by expires_at limit ${batch} for update skip locked)
      returning id, hold_id, listing_id`.execute(trx);
    for (const r of rows) await releaseHold(trx, r.hold_id, 'market_offer_release', { offer: r.id, listing: r.listing_id, status: 'expired' });
    return rows.length;
  });
}
