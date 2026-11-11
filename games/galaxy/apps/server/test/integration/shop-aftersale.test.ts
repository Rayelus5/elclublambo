import { randomUUID } from 'node:crypto';
import {
  type AdminCreatedPrice,
  type AdminPriceCheck,
  type AdminShopAlert,
  type AdminShopSummary,
  DEFAULT_SHOP_PRODUCTS,
  parseConfig,
  type ShopCheckout,
  type ShopView,
} from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import type { ConfigService } from '../../src/config/service';
import { credit, debit, getWallet } from '../../src/economy/wallet';
import { fakeGateway } from '../fake-gateway';
import { createAdminViaCli, fixedConfig, get, post, randomIp, sessionCookie, testApp, testEnv, totpNow, uniqueName } from '../helpers';

// After a purchase (shop and lab plan, F4): refunds and disputes take back what is left (never below 0), block the
// account's shop, raise an alert and tell the player; the admin sees the shop, reviews alerts, blocks and unblocks,
// checks and makes Stripe prices, and syncs a purchase; the CLI reconciles and unblocks. The «antes» of a sale comes
// from the shop config's history.

const PRODUCTS = DEFAULT_SHOP_PRODUCTS.map((p, i) => ({ ...p, stripePriceId: `price_a${i}x` }));
const SHOP = { enabled: true, audience: 'everyone', products: PRODUCTS };

const clock = new Date();
const gateway = fakeGateway();
for (const p of PRODUCTS) gateway.setPrice(p.stripePriceId, p.priceCents);

let ctx: Awaited<ReturnType<typeof testApp>>;
let admin: { cookie: string; password: string };
beforeAll(async () => {
  ctx = await testApp({ now: () => clock, config: fixedConfig({ shop: SHOP }), shopGateway: gateway });
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret, clock) });
  expect(res.statusCode, res.body).toBe(200);
  admin = { cookie: sessionCookie(res), password };
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('sha');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id, username };
}
const deliver = (w: { body: string; signature: string }) =>
  ctx.app.inject({ method: 'POST', url: '/galaxy/api/shop/webhook', payload: w.body, headers: { 'content-type': 'application/json', 'stripe-signature': w.signature, 'cf-connecting-ip': randomIp() } });
/** A purchase opened, paid and delivered. */
async function bought(cookie: string, product: string) {
  const res = await post(ctx.app, '/galaxy/api/shop/checkout', { product, consent: true, terms: 'v1' }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(res.statusCode, res.body).toBe(200);
  const id = (res.json() as ShopCheckout).purchase;
  gateway.pay(id);
  expect((await deliver(gateway.webhook('checkout.session.completed', id))).statusCode).toBe(200);
  return id;
}
const row = (id: string) => ctx.db.selectFrom('galaxy.shop_purchases').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const alertsOf = async (purchase: string) => ((await get(ctx.app, '/galaxy/api/admin/shop/alerts?open=false', { cookie: admin.cookie })).json() as AdminShopAlert[]).filter((a) => a.purchase === purchase);
const blocked = async (id: string) => (await ctx.db.selectFrom('galaxy.shop_blocks').select('reason').where('account_id', '=', id).executeTakeFirst()) !== undefined;
const mailTitles = async (id: string) =>
  (await ctx.db.selectFrom('galaxy.mailbox_receipts as r').innerJoin('galaxy.mailbox_messages as m', 'm.id', 'r.message_id').select('m.title').where('r.account_id', '=', id).execute()).map((m) => m.title);

describe('devoluciones y contracargos', () => {
  test('una devolución completa quita lo entregado, bloquea la tienda, avisa al admin y escribe al jugador', async () => {
    const p = await player();
    const id = await bought(p.cookie, 'coins-3');
    expect((await getWallet(ctx.db, p.id)).coins).toBe(5000);
    expect((await deliver(gateway.refund(id, 1299))).statusCode).toBe(200);
    expect((await getWallet(ctx.db, p.id)).coins).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'refunded', refunded_cents: 1299, clawed: { coins: 5000, dust: 0, components: 0 } });
    expect(await blocked(p.id)).toBe(true);
    expect((await alertsOf(id)).map((a) => [a.kind, a.details])).toEqual([['refund', expect.objectContaining({ refundedCents: 1299, taken: { coins: 5000, dust: 0, components: 0 }, short: { coins: 0, dust: 0, components: 0 } })]]);
    expect(await mailTitles(p.id)).toContain('Compra devuelta');
    expect((await get(ctx.app, '/galaxy/api/shop', { cookie: p.cookie })).json()).toMatchObject({ open: false, closed: 'blocked' });
  });

  test('una devolución parcial quita su parte; la siguiente, solo lo que falta; lo gastado no se puede quitar', async () => {
    const p = await player();
    const id = await bought(p.cookie, 'dust-2');
    // 1200 given (600 and the first purchase's 600); 1000 spent.
    await debit(ctx.db, p.id, 'dust', 1000, 'test');
    expect((await deliver(gateway.refund(id, 349))).statusCode).toBe(200);
    // 349/699 of 1200 is 599: only 200 were left.
    expect((await getWallet(ctx.db, p.id)).dust).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'partially_refunded', refunded_cents: 349, clawed: { dust: 599 } });
    const [first] = await alertsOf(id);
    expect(first!.details).toMatchObject({ taken: { dust: 200 }, short: { dust: 399 } });
    // The rest refunded later: only the new share.
    await credit(ctx.db, p.id, 'dust', 700, 'test');
    expect((await deliver(gateway.refund(id, 699))).statusCode).toBe(200);
    expect((await getWallet(ctx.db, p.id)).dust).toBe(99);
    expect(await row(id)).toMatchObject({ status: 'refunded', refunded_cents: 699, clawed: { dust: 1200 } });
    // The same refund again changes nothing.
    expect((await deliver(gateway.refund(id, 699))).statusCode).toBe(200);
    expect((await getWallet(ctx.db, p.id)).dust).toBe(99);
    expect(await alertsOf(id)).toHaveLength(2);
  });

  test('un contracargo quita todo lo que quede y bloquea; al cerrarse, solo avisa', async () => {
    const p = await player();
    const id = await bought(p.cookie, 'kit-arranque');
    expect((await deliver(gateway.dispute('charge.dispute.created', id))).statusCode).toBe(200);
    expect(await getWallet(ctx.db, p.id)).toMatchObject({ coins: 0, dust: 0 });
    expect((await getWallet(ctx.db, p.id))['components'] ?? 0).toBe(0);
    expect(await row(id)).toMatchObject({ status: 'disputed' });
    expect(await blocked(p.id)).toBe(true);
    expect(await mailTitles(p.id)).toContain('Compra en disputa');
    expect((await deliver(gateway.dispute('charge.dispute.closed', id, 'won'))).statusCode).toBe(200);
    expect((await alertsOf(id)).map((a) => a.kind).sort()).toEqual(['dispute', 'dispute_closed']);
  });
});

describe('el admin', () => {
  test('ve lo ganado, las compras y la pestaña de la tienda del jugador', async () => {
    const p = await player();
    await bought(p.cookie, 'components-1');
    const s = (await get(ctx.app, '/galaxy/api/admin/shop/summary', { cookie: admin.cookie })).json() as AdminShopSummary;
    expect(s).toMatchObject({ enabled: true, audience: 'everyone', ready: true, mode: 'live' });
    expect(s.paid.allCents).toBeGreaterThanOrEqual(399);
    const list = (await get(ctx.app, `/galaxy/api/admin/shop/purchases?username=${p.username}`, { cookie: admin.cookie })).json();
    expect(list.rows).toEqual([expect.objectContaining({ username: p.username, product: 'components-1', status: 'paid', amountCents: 399, firstBonus: true, grants: { coins: 0, dust: 0, components: 200 } })]);
    const tab = (await get(ctx.app, `/galaxy/api/admin/players/${p.username}/shop`, { cookie: admin.cookie })).json();
    expect(tab.rows).toEqual([expect.objectContaining({ product: 'components-1', status: 'paid', amount: '3,99 €' })]);
    // Players never reach it.
    expect((await get(ctx.app, '/galaxy/api/admin/shop/summary', { cookie: p.cookie })).statusCode).toBe(403);
  });

  test('revisa un aviso una vez', async () => {
    const p = await player();
    const id = await bought(p.cookie, 'coins-1');
    await deliver(gateway.refund(id, 399));
    const [alert] = await alertsOf(id);
    const review = (body: unknown) => post(ctx.app, `/galaxy/api/admin/shop/alerts/${alert!.id}/review`, body, { cookie: admin.cookie });
    expect((await review({ reason: 'Revisada con el jugador' })).json()).toEqual({ reviewed: true });
    expect((await review({ reason: 'Otra vez' })).json()).toEqual({ error: 'alert_reviewed' });
  });

  test('bloquea y desbloquea con su contraseña, y queda auditado', async () => {
    const p = await player();
    const call = (path: string, password: string) => post(ctx.app, `/galaxy/api/admin/shop/blocks/${p.username}/${path}`, { reason: 'Prueba de bloqueo', password }, { cookie: admin.cookie });
    expect((await call('block', 'otra-clave')).statusCode).toBe(401);
    expect((await call('block', admin.password)).json()).toEqual({ blocked: true });
    expect(await blocked(p.id)).toBe(true);
    expect((await call('unblock', admin.password)).json()).toEqual({ blocked: false });
    expect(await blocked(p.id)).toBe(false);
    const audit = await ctx.db.selectFrom('galaxy.admin_audit_log').select('action').where('target_id', '=', p.id).where('action', 'like', 'shop.%').execute();
    expect(audit.map((a) => a.action).sort()).toEqual(['shop.block', 'shop.unblock']);
  });

  test('comprueba los precios de Stripe del catálogo y sincroniza una compra', async () => {
    const p = await player();
    const res = await post(ctx.app, '/galaxy/api/shop/checkout', { product: 'dust-6', consent: true, terms: 'v1' }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    const id = (res.json() as ShopCheckout).purchase;
    gateway.pay(id);
    const synced = (await post(ctx.app, `/galaxy/api/admin/shop/purchases/${id}/sync`, {}, { cookie: admin.cookie })).json();
    expect(synced).toMatchObject({ id, status: 'paid' });
    expect((await getWallet(ctx.db, p.id)).dust).toBe(23000);
    gateway.setPrice(priceOf('coins-2'), 799);
    try {
      const checks = (await post(ctx.app, '/galaxy/api/admin/shop/prices/verify', {}, { cookie: admin.cookie })).json() as AdminPriceCheck[];
      expect(checks).toHaveLength(PRODUCTS.length);
      expect(checks.filter((c) => c.problem !== null)).toEqual([expect.objectContaining({ product: 'coins-2', where: 'price', expectedCents: 699, stripeCents: 799, problem: 'amount' })]);
    } finally {
      gateway.setPrice(priceOf('coins-2'), 699);
    }
  });

  test('crea en Stripe los precios que faltan, con su contraseña', async () => {
    const products = PRODUCTS.map((p) => (p.id === 'coins-1' ? { ...p, stripePriceId: null, enabled: false } : p));
    const app = await testApp({ now: () => clock, config: fixedConfig({ shop: { ...SHOP, products } }), shopGateway: gateway });
    try {
      const made = (await post(app.app, '/galaxy/api/admin/shop/prices/create', { reason: 'Precios nuevos', password: admin.password }, { cookie: admin.cookie })).json() as AdminCreatedPrice[];
      expect(made).toEqual([{ product: 'coins-1', where: 'price', cents: 399, priceId: 'price_madecoins1399' }]);
      expect(gateway.createdPrices.at(-1)).toMatchObject({ productId: 'coins-1', cents: 399 });
    } finally {
      await app.close();
    }
  });
});

describe('la CLI', () => {
  const cli = async (argv: string[]) => {
    const lines: string[] = [];
    const code = await runCli(argv, { db: ctx.db, env: testEnv(), out: (s) => lines.push(s), shopGateway: gateway });
    return { code, out: lines.join('\n') };
  };

  test('shop-reconcile entrega lo pagado sin webhook; shop-unblock desbloquea', async () => {
    const p = await player();
    const res = await post(ctx.app, '/galaxy/api/shop/checkout', { product: 'coins-5', consent: true, terms: 'v1' }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    const id = (res.json() as ShopCheckout).purchase;
    gateway.pay(id);
    // Other tests' payments (another fake Stripe) are counted as unanswered; this one is delivered.
    const r = await cli(['shop-reconcile', '--days', '1']);
    expect(r.out).toMatch(/^Revisadas \d+ compras de los últimos 1 días: [1-9]\d* entregadas/);
    expect((await row(id)).status).toBe('paid');
    expect((await getWallet(ctx.db, p.id)).coins).toBe(22000);
    await ctx.db.insertInto('galaxy.shop_blocks').values({ account_id: p.id, reason: 'prueba' }).execute();
    expect((await cli(['shop-unblock', p.username, '--reason', 'Revisado'])).out).toBe(`Tienda de ${p.username} desbloqueada`);
    expect(await blocked(p.id)).toBe(false);
    expect((await cli(['shop-unblock', p.username, '--reason', 'Revisado'])).out).toBe(`La tienda de ${p.username} no estaba bloqueada`);
  });
});

describe('el precio de antes', () => {
  test('una rebaja muestra tachado el precio más bajo de los 30 días anteriores', async () => {
    const start = new Date(clock.getTime() - 86_400_000);
    const offer = { kind: 'price', priceCents: 1999, stripePriceId: 'price_saleA', startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 7 * 86_400_000).toISOString() };
    gateway.setPrice('price_saleA', 1999);
    const live = { ...SHOP, products: PRODUCTS.map((p) => (p.id === 'coins-4' ? { ...p, offer } : p)) };
    const base = fixedConfig({ shop: live });
    const config: ConfigService = {
      ...base,
      versions: async (key) =>
        key === 'shop'
          ? [
              { version: 1, data: { ...SHOP, products: PRODUCTS.map((p) => (p.id === 'coins-4' ? { ...p, priceCents: 2299 } : p)) }, createdAt: new Date(start.getTime() - 20 * 86_400_000).toISOString(), createdBy: null, note: '' },
              { version: 2, data: live, createdAt: new Date(start.getTime() - 10 * 86_400_000).toISOString(), createdBy: null, note: '' },
            ]
          : [],
    };
    expect(parseConfig('shop', live).products.find((p) => p.id === 'coins-4')!.offer).not.toBeNull();
    const app = await testApp({ now: () => clock, config, shopGateway: gateway });
    try {
      const p = await post(app.app, '/galaxy/api/auth/register', { username: uniqueName('shb'), password: 'una-clave-larga' });
      const v = (await get(app.app, '/galaxy/api/shop', { cookie: sessionCookie(p) })).json() as ShopView;
      expect(v.products.find((x) => x.id === 'coins-4')).toMatchObject({ priceCents: 1999, beforeCents: 2299, offer: { kind: 'price' } });
      expect(v.products.find((x) => x.id === 'coins-3')).toMatchObject({ priceCents: 1299, beforeCents: null, offer: null });
    } finally {
      await app.close();
    }
  });
});

function priceOf(product: string): string {
  return PRODUCTS.find((p) => p.id === product)!.stripePriceId;
}
