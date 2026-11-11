import {
  type AdminCreatedPrice,
  type AdminPriceCheck,
  type AdminShopAlert,
  type AdminShopBlock,
  type AdminShopPurchase,
  type AdminShopSummary,
  activeOffer,
  referencePrice,
  type ShopAmounts,
  type ShopPurchaseStatus,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { madridDay } from '../economy/day';
import { HttpError } from '../errors';
import type { GatewayPrice } from './gateway';
import { applySession, priceMatches, type ShopDeps } from './service';

// The resource shop for admins (shop and lab plan, F4): what it earns, the purchases, alerts, blocks, and the Stripe
// prices of the catalogue. Every change is audited (reviewing an alert, blocking, unblocking, making prices).

type Db = Kysely<DB>;
const PAGE = 50;
/** Purchases that took money and kept it (a partial refund keeps the rest). */
const EARNING: ShopPurchaseStatus[] = ['paid', 'partially_refunded'];
const iso = (d: Date | null) => (d ? d.toISOString() : null);

async function accountOf(db: Db, username: string): Promise<{ id: string; username: string }> {
  const a = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where(sql<string>`lower(username)`, '=', username.toLowerCase()).executeTakeFirst();
  if (!a) throw new HttpError(404, 'player_not_found');
  return a;
}

export async function shopSummary(deps: ShopDeps): Promise<AdminShopSummary> {
  const cfg = await deps.config.get('shop');
  const now = deps.now();
  const since = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const earned = (from: Date | null) =>
    deps.db
      .selectFrom('galaxy.shop_purchases')
      .select(sql<number>`coalesce(sum(amount_cents - refunded_cents), 0)::int`.as('cents'))
      .where('status', 'in', EARNING)
      .$if(from !== null, (q) => q.where('paid_at', '>=', from!))
      .executeTakeFirstOrThrow()
      .then((r) => r.cents);
  const [today, week, month, all, counts, refunded, disputed, openAlerts, blocked, products] = await Promise.all([
    deps.db
      .selectFrom('galaxy.shop_purchases')
      .select(sql<number>`coalesce(sum(amount_cents - refunded_cents), 0)::int`.as('cents'))
      .where('status', 'in', EARNING)
      .where('madrid_day', '=', madridDay(now))
      .executeTakeFirstOrThrow()
      .then((r) => r.cents),
    earned(since(7)),
    earned(since(30)),
    earned(null),
    deps.db
      .selectFrom('galaxy.shop_purchases')
      .select([sql<number>`count(*)::int`.as('n'), sql<number>`count(distinct account_id)::int`.as('buyers')])
      .where('status', 'in', EARNING)
      .executeTakeFirstOrThrow(),
    deps.db.selectFrom('galaxy.shop_purchases').select(sql<number>`coalesce(sum(refunded_cents), 0)::int`.as('cents')).executeTakeFirstOrThrow(),
    deps.db.selectFrom('galaxy.shop_purchases').select(sql<number>`count(*)::int`.as('n')).where('status', '=', 'disputed').executeTakeFirstOrThrow(),
    deps.db.selectFrom('galaxy.shop_alerts').select(sql<number>`count(*)::int`.as('n')).where('reviewed_at', 'is', null).executeTakeFirstOrThrow(),
    deps.db.selectFrom('galaxy.shop_blocks').select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow(),
    deps.db
      .selectFrom('galaxy.shop_purchases')
      .select(['product', sql<string>`max(snapshot->'product'->>'name')`.as('name'), sql<number>`count(*)::int`.as('n'), sql<number>`sum(amount_cents - refunded_cents)::int`.as('cents')])
      .where('status', 'in', EARNING)
      .groupBy('product')
      .orderBy('n', 'desc')
      .limit(30)
      .execute(),
  ]);
  return {
    enabled: cfg.enabled,
    audience: cfg.audience,
    ready: deps.gateway !== null,
    mode: deps.gateway?.mode ?? null,
    paid: { todayCents: today, weekCents: week, monthCents: month, allCents: all, count: counts.n, buyers: counts.buyers },
    refundedCents: refunded.cents,
    disputed: disputed.n,
    openAlerts: openAlerts.n,
    blocked: blocked.n,
    products: products.map((p) => ({ product: p.product, name: p.name, count: p.n, cents: p.cents })),
  };
}

const PURCHASE_COLUMNS = ['p.id', 'a.username', 'p.product', 'p.snapshot', 'p.status', 'p.amount_cents', 'p.refunded_cents', 'p.first_bonus', 'p.granted', 'p.created_at', 'p.paid_at'] as const;

function purchasesOf(db: Db) {
  return db.selectFrom('galaxy.shop_purchases as p').innerJoin('galaxy.accounts as a', 'a.id', 'p.account_id');
}

function adminPurchase(r: {
  id: string;
  username: string;
  product: string;
  snapshot: unknown;
  status: string;
  amount_cents: number;
  refunded_cents: number;
  first_bonus: boolean;
  granted: unknown;
  created_at: Date;
  paid_at: Date | null;
}): AdminShopPurchase {
  const snap = r.snapshot as { product: { name: string }; total: ShopAmounts };
  return {
    id: r.id,
    username: r.username,
    product: r.product,
    name: snap.product.name,
    status: r.status as ShopPurchaseStatus,
    amountCents: r.amount_cents,
    refundedCents: r.refunded_cents,
    firstBonus: r.first_bonus,
    grants: (r.granted as ShopAmounts | null) ?? snap.total,
    createdAt: r.created_at.toISOString(),
    paidAt: iso(r.paid_at),
  };
}

export async function shopPurchases(deps: ShopDeps, q: { status?: ShopPurchaseStatus; username?: string; page: number }): Promise<{ rows: AdminShopPurchase[]; page: number; pages: number }> {
  const account = q.username ? await accountOf(deps.db, q.username) : null;
  const base = purchasesOf(deps.db)
    .$if(q.status !== undefined, (b) => b.where('p.status', '=', q.status!))
    .$if(account !== null, (b) => b.where('p.account_id', '=', account!.id));
  const [total, rows] = await Promise.all([
    base.select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow(),
    base.select([...PURCHASE_COLUMNS]).orderBy('p.created_at', 'desc').limit(PAGE).offset((q.page - 1) * PAGE).execute(),
  ]);
  return { rows: rows.map(adminPurchase), page: q.page, pages: Math.max(1, Math.ceil(total.n / PAGE)) };
}

/** Asks Stripe about a purchase now (the webhook never came): delivered, expired or as it was. */
export async function syncPurchase(deps: ShopDeps, id: string): Promise<AdminShopPurchase> {
  const r = await deps.db.selectFrom('galaxy.shop_purchases').select(['id', 'stripe_session_id']).where('id', '=', id).executeTakeFirst();
  if (!r) throw new HttpError(404, 'shop_purchase_not_found');
  if (!deps.gateway) throw new HttpError(503, 'payment_unavailable');
  if (r.stripe_session_id) await applySession(deps, r.id, await deps.gateway.retrieveCheckoutSession(r.stripe_session_id));
  return adminPurchase(await purchasesOf(deps.db).select([...PURCHASE_COLUMNS]).where('p.id', '=', id).executeTakeFirstOrThrow());
}

export async function shopAlerts(deps: ShopDeps, open: boolean): Promise<AdminShopAlert[]> {
  const rows = await deps.db
    .selectFrom('galaxy.shop_alerts as s')
    .leftJoin('galaxy.accounts as a', 'a.id', 's.account_id')
    .leftJoin('galaxy.accounts as r', 'r.id', 's.reviewed_by')
    .leftJoin('galaxy.shop_purchases as p', 'p.id', 's.purchase_id')
    .select(['s.id', 's.kind', 'a.username', 's.purchase_id', 'p.product', 's.details', 's.created_at', 's.reviewed_at', 'r.username as reviewer'])
    .$if(open, (q) => q.where('s.reviewed_at', 'is', null))
    .orderBy('s.id', 'desc')
    .limit(200)
    .execute();
  return rows.map((r) => ({
    id: String(r.id),
    kind: r.kind as AdminShopAlert['kind'],
    username: r.username,
    purchase: r.purchase_id,
    product: r.product,
    details: r.details as Record<string, unknown>,
    createdAt: r.created_at.toISOString(),
    reviewedAt: iso(r.reviewed_at),
    reviewer: r.reviewer,
  }));
}

export async function reviewShopAlert(deps: ShopDeps, actor: AuditActor, id: string, reason: string): Promise<{ reviewed: true }> {
  return inTransaction(deps.db, async (trx) => {
    const a = await trx.selectFrom('galaxy.shop_alerts').select(['kind', 'reviewed_at']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!a) throw new HttpError(404, 'not_found');
    if (a.reviewed_at) throw new HttpError(409, 'alert_reviewed');
    await trx.updateTable('galaxy.shop_alerts').set({ reviewed_at: deps.now(), reviewed_by: actor.id }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'shop.alert_review', targetType: 'shop_alert', targetId: id, before: { kind: a.kind }, reason });
    return { reviewed: true };
  });
}

export async function shopBlocks(deps: ShopDeps): Promise<AdminShopBlock[]> {
  const rows = await deps.db
    .selectFrom('galaxy.shop_blocks as b')
    .innerJoin('galaxy.accounts as a', 'a.id', 'b.account_id')
    .leftJoin('galaxy.accounts as by', 'by.id', 'b.created_by')
    .select(['a.username', 'b.reason', 'b.purchase_id', 'b.created_at', 'by.username as by'])
    .orderBy('b.created_at', 'desc')
    .limit(500)
    .execute();
  return rows.map((r) => ({ username: r.username, reason: r.reason, purchase: r.purchase_id, createdAt: r.created_at.toISOString(), by: r.by }));
}

/** Closes (or opens again) one account's shop. */
export async function setShopBlock(deps: ShopDeps, actor: AuditActor, username: string, blocked: boolean, reason: string): Promise<{ blocked: boolean }> {
  const a = await accountOf(deps.db, username);
  return inTransaction(deps.db, async (trx) => {
    if (blocked) {
      await trx.insertInto('galaxy.shop_blocks').values({ account_id: a.id, reason: reason.slice(0, 200), created_by: actor.id }).onConflict((oc) => oc.column('account_id').doNothing()).execute();
    } else {
      await trx.deleteFrom('galaxy.shop_blocks').where('account_id', '=', a.id).execute();
    }
    await writeAudit(trx, { actor, action: blocked ? 'shop.block' : 'shop.unblock', targetType: 'account', targetId: a.id, reason });
    return { blocked };
  });
}

function problemOf(p: GatewayPrice | null, cents: number, mode: 'live' | 'test'): AdminPriceCheck['problem'] {
  if (!p) return 'unreadable';
  if (priceMatches(p, cents, mode)) return null;
  if (p.livemode !== (mode === 'live')) return 'mode';
  if (!p.active) return 'inactive';
  if (!p.oneTime) return 'recurring';
  if (p.currency !== 'eur') return 'currency';
  return 'amount';
}

/** Every Stripe price of the catalogue (and of its sales) against the price shown, with the «antes» of a sale now. */
export async function verifyPrices(deps: ShopDeps): Promise<AdminPriceCheck[]> {
  const gateway = deps.gateway;
  if (!gateway) throw new HttpError(503, 'payment_unavailable');
  const cfg = await deps.config.get('shop');
  const now = deps.now();
  const history = (await deps.config.versions('shop')).map((v) => ({ at: new Date(v.createdAt), data: v.data }));
  const checks: AdminPriceCheck[] = [];
  for (const p of cfg.products) {
    const rows: { where: AdminPriceCheck['where']; id: string | null; cents: number; before: number | null }[] = [{ where: 'price', id: p.stripePriceId, cents: p.priceCents, before: null }];
    if (p.offer?.kind === 'price') {
      const o = activeOffer(p, now);
      const ref = o ? referencePrice(history, p.id, new Date(p.offer.startsAt)) : null;
      rows.push({ where: 'offer', id: p.offer.stripePriceId, cents: p.offer.priceCents, before: ref !== null && ref > p.offer.priceCents ? ref : null });
    }
    for (const r of rows) {
      let price: GatewayPrice | null = null;
      if (r.id) {
        try {
          price = await gateway.retrievePrice(r.id);
        } catch {
          price = null;
        }
      }
      checks.push({
        product: p.id,
        name: p.name,
        where: r.where,
        priceId: r.id,
        expectedCents: r.cents,
        stripeCents: price?.unitAmount ?? null,
        problem: r.id ? problemOf(price, r.cents, gateway.mode) : 'missing',
        beforeCents: r.before,
      });
    }
  }
  return checks;
}

/** Makes the Stripe prices the catalogue lacks (each product's, and its sale's); the admin then puts them in and publishes. */
export async function createMissingPrices(deps: ShopDeps, actor: AuditActor, reason: string): Promise<AdminCreatedPrice[]> {
  const gateway = deps.gateway;
  if (!gateway) throw new HttpError(503, 'payment_unavailable');
  const cfg = await deps.config.get('shop');
  const made: AdminCreatedPrice[] = [];
  for (const p of cfg.products) {
    if (p.stripePriceId === null) made.push({ product: p.id, where: 'price', cents: p.priceCents, priceId: (await gateway.createPrice({ productId: p.id, name: p.name, cents: p.priceCents })).id });
    if (p.offer?.kind === 'price' && p.offer.stripePriceId === null) {
      made.push({ product: p.id, where: 'offer', cents: p.offer.priceCents, priceId: (await gateway.createPrice({ productId: p.id, name: p.name, cents: p.offer.priceCents })).id });
    }
  }
  await writeAudit(deps.db, { actor, action: 'shop.prices_create', targetType: 'config', targetId: 'shop', after: made, reason });
  return made;
}

/** A player's purchases and shop block, for the player sheet's «Tienda» tab. */
export async function playerShopRows(db: Db, accountId: string, page: number): Promise<{ rows: Record<string, string | number | boolean | null>[]; total: number }> {
  const euros = (c: number) => `${(c / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const [total, rows, block] = await Promise.all([
    db.selectFrom('galaxy.shop_purchases').select(sql<number>`count(*)::int`.as('n')).where('account_id', '=', accountId).executeTakeFirstOrThrow(),
    db
      .selectFrom('galaxy.shop_purchases')
      .select(['id', 'created_at', 'product', 'status', 'amount_cents', 'refunded_cents', 'paid_at'])
      .where('account_id', '=', accountId)
      .orderBy('created_at', 'desc')
      .limit(PAGE)
      .offset((page - 1) * PAGE)
      .execute(),
    db.selectFrom('galaxy.shop_blocks').select(['reason', 'created_at']).where('account_id', '=', accountId).executeTakeFirst(),
  ]);
  const out = rows.map((r) => ({ at: r.created_at.toISOString(), product: r.product, status: r.status, amount: euros(r.amount_cents), refunded: r.refunded_cents > 0 ? euros(r.refunded_cents) : null, paid: iso(r.paid_at) }));
  if (block && page === 1) out.unshift({ at: block.created_at.toISOString(), product: 'Tienda bloqueada', status: block.reason, amount: '', refunded: null, paid: null });
  return { rows: out, total: total.n };
}
