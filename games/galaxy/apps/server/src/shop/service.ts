import {
  activeOffer,
  effectivePrice,
  referencePrice,
  type ShopVersion,
  type LiveEvent,
  productBlock,
  productTab,
  purchaseGrants,
  SHOP_CURRENCIES,
  type ShopAmounts,
  type ShopCheckout,
  type ShopCheckoutRequest,
  type ShopConfig,
  shopOpenFor,
  type ShopProduct,
  type ShopProductView,
  type ShopPurchaseStatus,
  type ShopPurchaseView,
  type ShopView,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { isStaff } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigService } from '../config/service';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { madridDay } from '../economy/day';
import { runOperation } from '../economy/operations';
import { credit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import type { GatewayPrice, GatewaySession, ShopGateway } from './gateway';

// The resource shop on the server (shop and lab plan, F4). Paying is two steps:
// 1. `openCheckout` keeps the purchase in an idempotent operation under the account's shop lock: the shop open for it,
//    the product for sale, once-only products and the first-purchase extra, open payments and the daily limit, and
//    what it gives fixed now (the snapshot) with the consent. Stripe's price is checked against the one shown first.
//    Then, outside the transaction, Stripe's session is opened (its idempotency key is the purchase).
// 2. The purchase is delivered once when Stripe says it is paid: its webhook, or the purchase's own check when the
//    webhook is late. The delivery locks the purchase row, credits the snapshot (no multipliers, no caps) and marks it
//    paid, with an operation row as a backstop; then the live socket tells the player.

type Db = Kysely<DB>;

export interface ShopDeps {
  db: Db;
  /** The live config, and the shop's history (the «antes» of a sale). */
  config: Pick<ConfigService, 'get' | 'getVersioned' | 'versions'>;
  now: () => Date;
  gateway: ShopGateway | null;
  /** The first is the shop's public origin (Stripe's return URL is built from it, never from the request). */
  origins: string[];
  live?: { send(accountId: string, event: LiveEvent): void };
  log?: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

/** A purchase Stripe's session can still change. */
const OPEN: ShopPurchaseStatus[] = ['creating', 'pending'];
/** A purchase that never took money (it frees its limits and its once-only reservations). */
const DEAD: ShopPurchaseStatus[] = ['expired', 'failed'];
/** A purchase that took money: only these make a once-only product bought and use up its first-purchase extra. */
const TAKEN: ShopPurchaseStatus[] = ['paid', 'refunded', 'partially_refunded', 'disputed'];
/** An unfinished payment is picked up again only while it has at least this long left. */
const RESUME_MS = 5 * 60_000;
/** Our purchase outlives Stripe's session by a few minutes (its own expiry is 30 min, Stripe's minimum). */
const PURCHASE_MS = 35 * 60_000;
const SESSION_MS = 34 * 60_000;
/** The purchase's own check asks Stripe only after this long (the webhook usually comes first). */
const CHECK_AFTER_MS = 5_000;
const PRICE_TTL_MS = 5 * 60_000;
const HISTORY_TTL_MS = 60_000;

interface Snapshot {
  product: { id: string; name: string; kind: ShopProduct['kind']; art: string };
  base: ShopAmounts;
  extra: ShopAmounts;
  total: ShopAmounts;
  priceCents: number;
  offer: ShopProduct['offer'];
}

/** The shop's own lock per account (checkouts of one account never race on its limits). */
async function lockShop(trx: Db, accountId: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`shop:${accountId}`}, 0))`.execute(trx);
}

/** Payments whose time is over are expired (Stripe's session expired with them); a late payment is still delivered. */
async function expireStale(db: Db, accountId: string, now: Date): Promise<void> {
  await db
    .updateTable('galaxy.shop_purchases')
    .set({ status: 'expired', updated_at: now })
    .where('account_id', '=', accountId)
    .where('status', 'in', OPEN)
    .where('expires_at', '<=', now)
    .execute();
}

async function isBlocked(db: Db, accountId: string): Promise<boolean> {
  return (await db.selectFrom('galaxy.shop_blocks').select('account_id').where('account_id', '=', accountId).executeTakeFirst()) !== undefined;
}

/**
 * Per product: how many purchases took money, and whether one of them took the first-purchase extra. An unfinished
 * payment counts for nothing here: leaving the payment halfway never hides the welcome pack or the extra.
 */
async function purchaseCounts(db: Db, accountId: string): Promise<Map<string, { bought: number; firstUsed: boolean }>> {
  const rows = await db
    .selectFrom('galaxy.shop_purchases')
    .select(['product', sql<number>`count(*)::int`.as('bought'), sql<boolean>`bool_or(first_bonus)`.as('first_used')])
    .where('account_id', '=', accountId)
    .where('status', 'in', TAKEN)
    .groupBy('product')
    .execute();
  return new Map(rows.map((r) => [r.product, { bought: r.bought, firstUsed: r.first_used }]));
}

type OpenRow = {
  id: string;
  amount_cents: number;
  stripe_price_id: string;
  first_bonus: boolean;
  terms_version: string;
  expires_at: Date;
  stripe_session_id: string | null;
  snapshot: unknown;
};

/** The account's unfinished payments of one product, newest first. */
async function openOf(db: Db, accountId: string, product: string, now: Date): Promise<OpenRow[]> {
  return db
    .selectFrom('galaxy.shop_purchases')
    .select(['id', 'amount_cents', 'stripe_price_id', 'first_bonus', 'terms_version', 'expires_at', 'stripe_session_id', 'snapshot'])
    .where('account_id', '=', accountId)
    .where('product', '=', product)
    .where('status', 'in', OPEN)
    .where('expires_at', '>', now)
    .orderBy('created_at', 'desc')
    .execute();
}

/** Whether an unfinished payment can simply carry on: the same price, extra, terms and name, and time left. */
function resumable(r: OpenRow, product: ShopProduct, price: { cents: number; stripePriceId: string | null }, first: boolean, terms: string, now: Date): boolean {
  return (
    r.amount_cents === price.cents &&
    r.stripe_price_id === price.stripePriceId &&
    r.first_bonus === first &&
    r.terms_version === terms &&
    (r.snapshot as Snapshot).product.name === product.name &&
    r.expires_at.getTime() - now.getTime() > RESUME_MS
  );
}

/**
 * Closes an unfinished payment that cannot carry on, in Stripe first, so the same thing is never paid twice; if it had
 * been paid meanwhile, it is delivered instead.
 */
async function closeOpen(deps: ShopDeps, gateway: ShopGateway, r: OpenRow): Promise<void> {
  if (r.stripe_session_id) {
    let session: GatewaySession;
    try {
      session = await gateway.expireCheckoutSession(r.stripe_session_id);
    } catch {
      deps.log?.warn({ purchase: r.id }, 'shop_session_unexpired');
      throw new HttpError(503, 'payment_unavailable');
    }
    await applySession(deps, r.id, session);
    if (session.status !== 'expired') return;
  }
  await deps.db.updateTable('galaxy.shop_purchases').set({ status: 'expired', updated_at: deps.now() }).where('id', '=', r.id).where('status', 'in', OPEN).execute();
}

/** What the account spent today (Madrid) and still has open: every purchase that took or may take money. */
async function spentToday(db: Db, accountId: string, now: Date): Promise<number> {
  const row = await db
    .selectFrom('galaxy.shop_purchases')
    .select(sql<number>`coalesce(sum(amount_cents), 0)::int`.as('cents'))
    .where('account_id', '=', accountId)
    .where('madrid_day', '=', madridDay(now))
    .where('status', 'not in', DEAD)
    .executeTakeFirstOrThrow();
  return row.cents;
}

async function openPayments(db: Db, accountId: string, now: Date): Promise<number> {
  const row = await db
    .selectFrom('galaxy.shop_purchases')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('account_id', '=', accountId)
    .where('status', 'in', OPEN)
    .where('expires_at', '>', now)
    .executeTakeFirstOrThrow();
  return row.n;
}

function offerView(p: ShopProduct, now: Date): ShopProductView['offer'] {
  const o = activeOffer(p, now);
  if (!o) return null;
  return o.kind === 'bonus' ? { kind: 'bonus', percent: o.percent, endsAt: o.endsAt } : { kind: 'price', endsAt: o.endsAt };
}

// The shop config's history (its published versions), read at most once a minute per config service.
const historyCache = new WeakMap<object, { at: number; versions: ShopVersion[] }>();

async function shopHistory(deps: ShopDeps, now: number): Promise<ShopVersion[]> {
  const hit = historyCache.get(deps.config);
  if (hit && now - hit.at < HISTORY_TTL_MS) return hit.versions;
  const versions = (await deps.config.versions('shop')).map((v) => ({ at: new Date(v.createdAt), data: v.data }));
  historyCache.set(deps.config, { at: now, versions });
  return versions;
}

/** The struck «antes» of a price offer running now: the lowest of the 30 days before it, only when higher. */
async function beforeOf(deps: ShopDeps, p: ShopProduct, now: Date): Promise<number | null> {
  const o = activeOffer(p, now);
  if (o?.kind !== 'price') return null;
  const ref = referencePrice(await shopHistory(deps, now.getTime()), p.id, new Date(o.startsAt));
  return ref !== null && ref > o.priceCents ? ref : null;
}

/** Whether the shop is open for this account and has an offer running (the wallet's links and the menu's sign). */
export async function shopFlag(deps: Pick<ShopDeps, 'db' | 'config' | 'now' | 'gateway'>, session: SessionInfo): Promise<{ open: boolean; offer: boolean }> {
  const cfg = await deps.config.get('shop');
  const staff = isStaff(session);
  if (!shopOpenFor(cfg, deps.gateway !== null, staff) || (await isBlocked(deps.db, session.accountId))) return { open: false, offer: false };
  const now = deps.now();
  return { open: true, offer: cfg.products.some((p) => productBlock(p, { staff, bought: 0 }) === null && activeOffer(p, now) !== null) };
}

export async function shopView(deps: ShopDeps, session: SessionInfo): Promise<ShopView> {
  const cfg = await deps.config.get('shop');
  const now = deps.now();
  const staff = isStaff(session);
  const wallet = await getWallet(deps.db, session.accountId);
  const common = { firstPurchase: { ...cfg.firstPurchase }, legal: { ...cfg.legal }, wallet };
  const open = shopOpenFor(cfg, deps.gateway !== null, staff);
  const blocked = open && (await isBlocked(deps.db, session.accountId));
  if (!open || blocked) {
    return { open: false, closed: blocked ? 'blocked' : 'closed', publishableKey: null, products: [], limits: { ...cfg.limits, spentTodayCents: 0 }, ...common };
  }
  const [counts, spent] = await Promise.all([purchaseCounts(deps.db, session.accountId), spentToday(deps.db, session.accountId, now)]);
  const sellable = cfg.products.filter((p) => productBlock(p, { staff, bought: 0 }) !== 'unavailable');
  const before = new Map(await Promise.all(sellable.map(async (p) => [p.id, await beforeOf(deps, p, now)] as const)));
  const products = sellable.map((p): ShopProductView => {
      const c = counts.get(p.id) ?? { bought: 0, firstUsed: false };
      const first = p.firstBonus && cfg.firstPurchase.enabled && !c.firstUsed;
      const { base, extra, total } = purchaseGrants(p, now, first, cfg);
      const price = effectivePrice(p, now);
      const block = productBlock(p, { staff, bought: c.bought }) ?? (spent + price.cents > cfg.limits.dailyCents ? 'daily_limit' : null);
      return {
        id: p.id,
        kind: p.kind,
        tab: productTab(p),
        name: p.name,
        art: p.art,
        base,
        bonus: { ...p.bonus },
        extra,
        total,
        priceCents: price.cents,
        beforeCents: before.get(p.id) ?? null,
        offer: offerView(p, now),
        badge: p.badge,
        featured: p.featured,
        first,
        maxPerAccount: p.kind === 'welcome' ? 1 : p.maxPerAccount,
        bought: c.bought,
        block,
      };
    });
  return { open: true, closed: null, publishableKey: deps.gateway!.publishableKey, products, limits: { ...cfg.limits, spentTodayCents: spent }, ...common };
}

// Stripe's prices, read at most every few minutes per price.
const priceCache = new WeakMap<ShopGateway, Map<string, { at: number; price: GatewayPrice }>>();

async function stripePrice(gateway: ShopGateway, id: string, now: number): Promise<GatewayPrice> {
  let cache = priceCache.get(gateway);
  if (!cache) priceCache.set(gateway, (cache = new Map()));
  const hit = cache.get(id);
  if (hit && now - hit.at < PRICE_TTL_MS) return hit.price;
  const price = await gateway.retrievePrice(id);
  cache.set(id, { at: now, price });
  return price;
}

/** The price Stripe charges must be the one shown: in euros, one-off, active, of the gateway's mode and the same amount. */
export function priceMatches(price: GatewayPrice, cents: number, mode: ShopGateway['mode']): boolean {
  return price.active && price.oneTime && price.currency === 'eur' && price.unitAmount === cents && price.livemode === (mode === 'live');
}

async function alertPriceMismatch(db: Db, accountId: string, product: string, expected: number, price: GatewayPrice | null, id: string): Promise<void> {
  // One open alert per Stripe price is enough.
  const open = await db
    .selectFrom('galaxy.shop_alerts')
    .select('id')
    .where('kind', '=', 'price_mismatch')
    .where('reviewed_at', 'is', null)
    .where(sql<boolean>`details->>'price' = ${id}`)
    .executeTakeFirst();
  if (open) return;
  const details = { product, price: id, expected, got: price ? { amount: price.unitAmount, currency: price.currency, active: price.active, oneTime: price.oneTime, livemode: price.livemode } : null };
  await db.insertInto('galaxy.shop_alerts').values({ kind: 'price_mismatch', account_id: accountId, details: JSON.stringify(details) }).execute();
}

interface Reservation {
  purchase: string;
  priceId: string;
  product: string;
  name: string;
}

export async function openCheckout(deps: ShopDeps, session: SessionInfo, body: ShopCheckoutRequest, key: string, hash: string): Promise<ShopCheckout> {
  const cfg = await deps.config.get('shop');
  const gateway = deps.gateway;
  const now = deps.now();
  const staff = isStaff(session);
  const accountId = session.accountId;
  if (!gateway || !shopOpenFor(cfg, true, staff)) throw new HttpError(409, 'shop_closed');
  if (body.terms !== cfg.legal.termsVersion) throw new HttpError(409, 'shop_terms_outdated');
  const product = cfg.products.find((p) => p.id === body.product);
  if (!product || productBlock(product, { staff, bought: 0 }) === 'unavailable') throw new HttpError(409, 'shop_unavailable');
  const price = effectivePrice(product, now);
  if (!price.stripePriceId) throw new HttpError(409, 'shop_unavailable');

  // Stripe's price must be the one shown, before anything is kept.
  let stripe: GatewayPrice;
  try {
    stripe = await stripePrice(gateway, price.stripePriceId, now.getTime());
  } catch {
    deps.log?.warn({ product: product.id }, 'shop_price_unreadable');
    throw new HttpError(503, 'payment_unavailable');
  }
  if (!priceMatches(stripe, price.cents, gateway.mode)) {
    await alertPriceMismatch(deps.db, accountId, product.id, price.cents, stripe, price.stripePriceId);
    throw new HttpError(409, 'shop_price_mismatch');
  }

  // An unfinished payment of this product carries on (the same Stripe session); one that cannot is closed first.
  const done = (await purchaseCounts(deps.db, accountId)).get(product.id) ?? { bought: 0, firstUsed: false };
  const first = product.firstBonus && cfg.firstPurchase.enabled && !done.firstUsed;
  for (const r of await openOf(deps.db, accountId, product.id, now)) {
    if (!resumable(r, product, price, first, body.terms, now)) await closeOpen(deps, gateway, r);
  }

  const reservation = await runOperation(deps.db, accountId, key, 'shop.checkout', hash, (trx) => reserve(trx, cfg, product, accountId, staff, now, body.terms, price));
  return startSession(deps, gateway, reservation, accountId);
}

async function reserve(
  trx: Db,
  cfg: ShopConfig,
  product: ShopProduct,
  accountId: string,
  staff: boolean,
  now: Date,
  terms: string,
  price: { cents: number; stripePriceId: string | null },
): Promise<Reservation> {
  await lockShop(trx, accountId);
  await expireStale(trx, accountId, now);
  if (await isBlocked(trx, accountId)) throw new HttpError(403, 'shop_blocked');
  const c = (await purchaseCounts(trx, accountId)).get(product.id) ?? { bought: 0, firstUsed: false };
  const block = productBlock(product, { staff, bought: c.bought });
  if (block === 'once_used') throw new HttpError(409, 'shop_once_used');
  if (block) throw new HttpError(409, 'shop_unavailable');
  const first = product.firstBonus && cfg.firstPurchase.enabled && !c.firstUsed;
  // Pressing «Comprar» again carries on with the unfinished payment of this product (its limits already count it).
  const open = (await openOf(trx, accountId, product.id, now)).find((r) => resumable(r, product, price, first, terms, now));
  if (open) return { purchase: open.id, priceId: open.stripe_price_id, product: product.id, name: product.name };
  if ((await openPayments(trx, accountId, now)) >= cfg.limits.pendingMax) throw new HttpError(409, 'shop_pending_limit');
  if ((await spentToday(trx, accountId, now)) + price.cents > cfg.limits.dailyCents) throw new HttpError(409, 'shop_daily_limit');
  const { base, extra, total } = purchaseGrants(product, now, first, cfg);
  const snapshot: Snapshot = { product: { id: product.id, name: product.name, kind: product.kind, art: product.art }, base, extra, total, priceCents: price.cents, offer: activeOffer(product, now) };
  const row = await trx
    .insertInto('galaxy.shop_purchases')
    .values({
      account_id: accountId,
      product: product.id,
      snapshot: JSON.stringify(snapshot),
      amount_cents: price.cents,
      stripe_price_id: price.stripePriceId!,
      first_bonus: first,
      consent_at: now,
      terms_version: terms,
      madrid_day: madridDay(now),
      created_at: now,
      expires_at: new Date(now.getTime() + PURCHASE_MS),
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { purchase: row.id, priceId: price.stripePriceId!, product: product.id, name: product.name };
}

/** Opens (or, repeated, finds again: Stripe's idempotency) the purchase's payment session. */
async function startSession(deps: ShopDeps, gateway: ShopGateway, r: Reservation, accountId: string): Promise<ShopCheckout> {
  const row = await deps.db.selectFrom('galaxy.shop_purchases').select(['status', 'created_at']).where('id', '=', r.purchase).executeTakeFirstOrThrow();
  if (!OPEN.includes(row.status as ShopPurchaseStatus)) throw new HttpError(503, 'payment_unavailable');
  let session: { id: string; clientSecret: string };
  try {
    session = await gateway.createCheckoutSession({
      purchaseId: r.purchase,
      accountId,
      productId: r.product,
      productName: r.name,
      priceId: r.priceId,
      returnUrl: `${deps.origins[0]}/galaxy/tienda?compra=${r.purchase}`,
      // Fixed by the purchase, so a repeated call sends the same request.
      expiresAt: new Date(row.created_at.getTime() + SESSION_MS),
    });
  } catch {
    await deps.db.updateTable('galaxy.shop_purchases').set({ status: 'failed', updated_at: deps.now() }).where('id', '=', r.purchase).where('status', '=', 'creating').execute();
    deps.log?.warn({ purchase: r.purchase }, 'shop_session_failed');
    throw new HttpError(503, 'payment_unavailable');
  }
  await deps.db
    .updateTable('galaxy.shop_purchases')
    .set({ status: 'pending', stripe_session_id: session.id, updated_at: deps.now() })
    .where('id', '=', r.purchase)
    .where('status', '=', 'creating')
    .execute();
  return { purchase: r.purchase, clientSecret: session.clientSecret };
}

type PurchaseRow = {
  id: string;
  account_id: string;
  product: string;
  snapshot: unknown;
  status: string;
  amount_cents: number;
  granted: unknown;
  created_at: Date;
  paid_at: Date | null;
};
const PURCHASE_COLUMNS = ['id', 'account_id', 'product', 'snapshot', 'status', 'amount_cents', 'granted', 'created_at', 'paid_at'] as const;

async function purchaseView(db: Db, r: PurchaseRow): Promise<ShopPurchaseView> {
  const snap = r.snapshot as Snapshot;
  return {
    id: r.id,
    product: r.product,
    name: snap.product.name,
    status: r.status as ShopPurchaseStatus,
    amountCents: r.amount_cents,
    grants: (r.granted as ShopAmounts | null) ?? snap.total,
    createdAt: r.created_at.toISOString(),
    paidAt: r.paid_at?.toISOString() ?? null,
    wallet: await getWallet(db, r.account_id),
  };
}

/**
 * Delivers a purchase Stripe says is paid, once: the purchase row is locked and only one still open (or expired: a
 * late payment is still the player's) is credited and marked paid. An amount or currency that is not the purchase's
 * is still delivered (the money was taken) and raises an alert. True when this call delivered it.
 */
export async function fulfil(deps: ShopDeps, purchaseId: string, session: GatewaySession): Promise<boolean> {
  if (!(session.status === 'complete' && session.paymentStatus === 'paid')) return false;
  const delivered = await inTransaction(deps.db, async (trx) => {
    const r = await trx.selectFrom('galaxy.shop_purchases').select([...PURCHASE_COLUMNS, 'stripe_session_id']).where('id', '=', purchaseId).forUpdate().executeTakeFirst();
    if (!r || !(['creating', 'pending', 'expired'] as string[]).includes(r.status)) return null;
    if (r.stripe_session_id !== null && r.stripe_session_id !== session.id) return null;
    const snap = r.snapshot as Snapshot;
    const key = `shop:${r.id}`;
    const now = deps.now();
    const ref = { purchase: r.id, product: r.product };
    for (const c of SHOP_CURRENCIES) if (snap.total[c] > 0) await credit(trx, r.account_id, c, snap.total[c], 'shop', ref, key);
    await trx
      .updateTable('galaxy.shop_purchases')
      .set({ status: 'paid', paid_at: now, granted: JSON.stringify(snap.total), stripe_session_id: session.id, stripe_payment_intent: session.paymentIntent, updated_at: now })
      .where('id', '=', r.id)
      .execute();
    // The operation row is a backstop: a second delivery of the same purchase could never commit.
    await trx.insertInto('galaxy.operations').values({ account_id: r.account_id, key, kind: 'shop.fulfil', request_hash: r.id, result: JSON.stringify({ purchase: r.id }) }).execute();
    if (session.amountTotal !== r.amount_cents || session.currency !== 'eur') {
      const details = { expected: r.amount_cents, got: session.amountTotal, currency: session.currency };
      await trx.insertInto('galaxy.shop_alerts').values({ kind: 'amount_mismatch', account_id: r.account_id, purchase_id: r.id, details: JSON.stringify(details) }).execute();
    }
    return { ...r, status: 'paid', granted: snap.total, paid_at: now };
  });
  if (!delivered) return false;
  deps.log?.info({ purchase: delivered.id, product: delivered.product }, 'shop_paid');
  deps.live?.send(delivered.account_id, { type: 'purchase', purchase: await purchaseView(deps.db, delivered) });
  return true;
}

/** What Stripe's session says of a purchase: paid (delivered), expired or failed. */
export async function applySession(deps: ShopDeps, purchaseId: string, session: GatewaySession, failed = false): Promise<void> {
  if (session.metadata.purchase !== undefined && session.metadata.purchase !== purchaseId) return;
  if (await fulfil(deps, purchaseId, session)) return;
  const status = failed ? 'failed' : session.status === 'expired' ? 'expired' : null;
  if (!status) return;
  await deps.db.updateTable('galaxy.shop_purchases').set({ status, updated_at: deps.now() }).where('id', '=', purchaseId).where('status', 'in', OPEN).execute();
}

/** A purchase of the account; while open, after a few seconds it asks Stripe itself (the webhook may be late). */
export async function purchaseStatus(deps: ShopDeps, accountId: string, id: string): Promise<ShopPurchaseView> {
  const read = () => deps.db.selectFrom('galaxy.shop_purchases').select([...PURCHASE_COLUMNS, 'stripe_session_id']).where('id', '=', id).where('account_id', '=', accountId).executeTakeFirst();
  let r = await read();
  if (!r) throw new HttpError(404, 'shop_purchase_not_found');
  const now = deps.now().getTime();
  if (deps.gateway && OPEN.includes(r.status as ShopPurchaseStatus) && r.stripe_session_id && now - r.created_at.getTime() >= CHECK_AFTER_MS) {
    try {
      await applySession(deps, r.id, await deps.gateway.retrieveCheckoutSession(r.stripe_session_id));
    } catch {
      deps.log?.warn({ purchase: r.id }, 'shop_session_unreadable');
    }
    r = (await read())!;
  }
  return purchaseView(deps.db, r);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The purchase a Stripe session belongs to: its metadata, or the session kept with it (null: not the shop's). */
export async function purchaseOfSession(db: Db, session: GatewaySession): Promise<string | null> {
  const byId = session.metadata.purchase;
  const row =
    byId !== undefined
      ? UUID.test(byId)
        ? await db.selectFrom('galaxy.shop_purchases').select('id').where('id', '=', byId).executeTakeFirst()
        : undefined
      : await db.selectFrom('galaxy.shop_purchases').select('id').where('stripe_session_id', '=', session.id).executeTakeFirst();
  return row?.id ?? null;
}
