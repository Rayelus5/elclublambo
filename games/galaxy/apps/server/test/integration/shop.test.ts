import { randomUUID } from 'node:crypto';
import { DEFAULT_SHOP_PRODUCTS, type ShopCheckout, type ShopPurchaseView, type ShopView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { getWallet } from '../../src/economy/wallet';
import { fakeGateway } from '../fake-gateway';
import { fixedConfig, get, post, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

// The resource shop on the server (shop and lab plan, F4), with a fake Stripe: the view, opening a payment (consent,
// terms, limits, the first-purchase extra, once-only products, Stripe's price checked), the delivery by webhook or by
// the purchase's own check (once, whatever arrives twice), expired and failed payments, and the webhook's guards.

const PRODUCTS = DEFAULT_SHOP_PRODUCTS.map((p, i) => ({ ...p, stripePriceId: `price_t${i}x` }));
const priceOf = (id: string) => PRODUCTS.find((p) => p.id === id)!;
const SHOP = { enabled: true, audience: 'everyone', products: PRODUCTS, limits: { dailyCents: 10_000, pendingMax: 3 } };

let clock = new Date();
const later = (ms: number) => (clock = new Date(clock.getTime() + ms));
const gateway = fakeGateway();
for (const p of PRODUCTS) gateway.setPrice(p.stripePriceId, p.priceCents);

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock, config: fixedConfig({ shop: SHOP }), shopGateway: gateway });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('shp'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}
const view = async (cookie: string, app = ctx.app) => (await get(app, '/galaxy/api/shop', { cookie })).json() as ShopView;
const checkout = (cookie: string, product: string, over: Record<string, unknown> = {}, key = randomUUID(), app = ctx.app) =>
  post(app, '/galaxy/api/shop/checkout', { product, consent: true, terms: 'v1', ...over }, { cookie, headers: { 'idempotency-key': key } });
const purchase = async (cookie: string, id: string) => (await get(ctx.app, `/galaxy/api/shop/purchases/${id}`, { cookie })).json() as ShopPurchaseView;
/** Stripe calling the webhook: no Origin, no session, the raw signed body. */
const deliver = (w: { body: string; signature: string }, app = ctx.app) =>
  app.inject({ method: 'POST', url: '/galaxy/api/shop/webhook', payload: w.body, headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': w.signature, 'cf-connecting-ip': randomIp() } });
async function opened(cookie: string, product: string) {
  const res = await checkout(cookie, product);
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as ShopCheckout).purchase;
}

describe('la tienda abierta', () => {
  test('la vista trae los productos con su precio, lo que dan y su extra de primera compra', async () => {
    const { cookie } = await player();
    const v = await view(cookie);
    expect(v).toMatchObject({ open: true, closed: null, publishableKey: 'pk_live_fake', limits: { dailyCents: 10_000, spentTodayCents: 0, pendingMax: 3 } });
    expect(v.products).toHaveLength(PRODUCTS.length);
    expect(v.products.find((p) => p.id === 'dust-2')).toMatchObject({ tab: 'dust', priceCents: 699, first: true, base: { dust: 600 }, extra: { dust: 600 }, total: { dust: 1200 }, block: null });
    expect(v.products.find((p) => p.id === 'welcome')).toMatchObject({ tab: 'packs', first: false, maxPerAccount: 1, bought: 0 });
  });

  test('pagar pide la casilla y las condiciones vigentes; abre el pago de Stripe con el precio de Stripe', async () => {
    const { cookie, id } = await player();
    expect((await checkout(cookie, 'coins-1', { consent: false })).statusCode).toBe(400);
    expect((await checkout(cookie, 'coins-1', { terms: 'v0' })).json()).toEqual({ error: 'shop_terms_outdated' });
    expect((await checkout(cookie, 'no-existe')).json()).toEqual({ error: 'shop_unavailable' });
    const res = await checkout(cookie, 'coins-1');
    expect(res.statusCode, res.body).toBe(200);
    const c = res.json() as ShopCheckout;
    expect(c.clientSecret).toMatch(/_secret_fake$/);
    const opened = gateway.created.at(-1)!;
    expect(opened).toMatchObject({ purchaseId: c.purchase, accountId: id, productId: 'coins-1', priceId: priceOf('coins-1').stripePriceId });
    expect(opened.returnUrl).toBe(`http://localhost:5173/galaxy/tienda?compra=${c.purchase}`);
    const row = await ctx.db.selectFrom('galaxy.shop_purchases').selectAll().where('id', '=', c.purchase).executeTakeFirstOrThrow();
    expect(row).toMatchObject({ status: 'pending', amount_cents: 399, first_bonus: true, terms_version: 'v1', stripe_session_id: gateway.sessionOfPurchase(c.purchase).id });
    expect(row.snapshot).toMatchObject({ total: { coins: 1000, dust: 0, components: 0 } });
    // The first-purchase extra is now taken by this payment.
    expect((await view(cookie)).products.find((p) => p.id === 'coins-1')).toMatchObject({ first: false, bought: 1 });
  });

  test('repetir la misma petición no abre otra compra ni otro pago', async () => {
    const { cookie } = await player();
    const key = randomUUID();
    const a = (await checkout(cookie, 'dust-1', {}, key)).json() as ShopCheckout;
    const b = (await checkout(cookie, 'dust-1', {}, key)).json() as ShopCheckout;
    expect(b).toEqual(a);
    expect(await ctx.db.selectFrom('galaxy.shop_purchases').select('id').where('product', '=', 'dust-1').where('stripe_session_id', '=', gateway.sessionOfPurchase(a.purchase).id).execute()).toHaveLength(1);
  });
});

describe('la entrega', () => {
  test('el webhook firmado entrega lo comprado una vez, aunque llegue dos veces', async () => {
    const { cookie, id } = await player();
    const p = await opened(cookie, 'components-3');
    const before = await getWallet(ctx.db, id);
    gateway.pay(p);
    const w = gateway.webhook('checkout.session.completed', p);
    expect((await deliver(w)).statusCode).toBe(200);
    expect((await deliver(w)).statusCode).toBe(200);
    // Another event about the same payment changes nothing either.
    expect((await deliver(gateway.webhook('checkout.session.completed', p))).statusCode).toBe(200);
    const after = await getWallet(ctx.db, id);
    expect(after['components']! - (before['components'] ?? 0)).toBe(1000);
    const v = await purchase(cookie, p);
    expect(v).toMatchObject({ status: 'paid', grants: { components: 1000 }, amountCents: 1299 });
    const ledger = await ctx.db.selectFrom('galaxy.ledger').select(['currency', 'delta', 'reason']).where('account_id', '=', id).where('reason', '=', 'shop').execute();
    expect(ledger).toEqual([{ currency: 'components', delta: '1000', reason: 'shop' }]);
  });

  test('si el webhook no llega, la propia compra pregunta a Stripe y entrega', async () => {
    const { cookie, id } = await player();
    const p = await opened(cookie, 'dust-3');
    gateway.pay(p);
    expect((await purchase(cookie, p)).status).toBe('pending');
    later(6_000);
    const v = await purchase(cookie, p);
    expect(v.status).toBe('paid');
    expect(v.wallet.dust).toBe(2500);
    expect((await getWallet(ctx.db, id)).dust).toBe(2500);
  });

  test('webhook y consulta a la vez entregan una sola vez', async () => {
    const { cookie, id } = await player();
    const p = await opened(cookie, 'coins-2');
    gateway.pay(p);
    later(6_000);
    await Promise.all([deliver(gateway.webhook('checkout.session.completed', p)), purchase(cookie, p), purchase(cookie, p)]);
    expect((await getWallet(ctx.db, id)).coins).toBe(2400);
  });

  test('un pago caducado libera el extra de primera compra y no entrega nada', async () => {
    const { cookie, id } = await player();
    const p = await opened(cookie, 'dust-2');
    gateway.expire(p);
    expect((await deliver(gateway.webhook('checkout.session.expired', p))).statusCode).toBe(200);
    expect((await purchase(cookie, p)).status).toBe('expired');
    expect((await getWallet(ctx.db, id)).dust).toBe(0);
    expect((await view(cookie)).products.find((x) => x.id === 'dust-2')).toMatchObject({ first: true, bought: 0 });
  });

  test('la compra de otro no se ve', async () => {
    const a = await player();
    const b = await player();
    const p = await opened(a.cookie, 'coins-1');
    expect((await get(ctx.app, `/galaxy/api/shop/purchases/${p}`, { cookie: b.cookie })).json()).toEqual({ error: 'shop_purchase_not_found' });
  });
});

describe('los límites', () => {
  test('el pack de bienvenida, una vez', async () => {
    const { cookie } = await player();
    const p = await opened(cookie, 'welcome');
    gateway.pay(p);
    await deliver(gateway.webhook('checkout.session.completed', p));
    expect((await checkout(cookie, 'welcome')).json()).toEqual({ error: 'shop_once_used' });
    expect((await view(cookie)).products.find((x) => x.id === 'welcome')!.block).toBe('once_used');
  });

  test('el límite diario cuenta lo pagado y lo abierto', async () => {
    const { cookie } = await player();
    await opened(cookie, 'coins-5');
    await opened(cookie, 'dust-5');
    expect((await checkout(cookie, 'coins-1')).json()).toEqual({ error: 'shop_daily_limit' });
    const v = await view(cookie);
    expect(v.limits.spentTodayCents).toBe(9998);
    expect(v.products.find((x) => x.id === 'coins-1')!.block).toBe('daily_limit');
  });

  test('no más pagos abiertos a la vez que los permitidos', async () => {
    const { cookie } = await player();
    for (const p of ['coins-1', 'dust-1', 'components-1']) await opened(cookie, p);
    expect((await checkout(cookie, 'coins-2')).json()).toEqual({ error: 'shop_pending_limit' });
  });

  test('un precio de Stripe distinto del mostrado no cobra y avisa al admin', async () => {
    const { cookie } = await player();
    const id = priceOf('kit-comandante').stripePriceId;
    gateway.setPrice(id, 4500);
    try {
      expect((await checkout(cookie, 'kit-comandante')).json()).toEqual({ error: 'shop_price_mismatch' });
    } finally {
      gateway.setPrice(id, 4999);
    }
    const alert = await ctx.db.selectFrom('galaxy.shop_alerts').select(['kind', 'details']).where('kind', '=', 'price_mismatch').orderBy('id', 'desc').executeTakeFirstOrThrow();
    expect(alert.details).toMatchObject({ product: 'kit-comandante', price: id, expected: 4999, got: { amount: 4500 } });
  });

  test('si Stripe falla al abrir el pago, la compra queda fallida y no cuenta', async () => {
    const { cookie } = await player();
    gateway.failNext = true;
    expect((await checkout(cookie, 'coins-6')).json()).toEqual({ error: 'payment_unavailable' });
    const v = await view(cookie);
    expect(v.limits.spentTodayCents).toBe(0);
    expect(v.products.find((x) => x.id === 'coins-6')).toMatchObject({ first: true, bought: 0 });
  });

  test('una cuenta bloqueada no compra', async () => {
    const { cookie, id } = await player();
    await ctx.db.insertInto('galaxy.shop_blocks').values({ account_id: id, reason: 'prueba' }).execute();
    expect(await view(cookie)).toMatchObject({ open: false, closed: 'blocked', products: [] });
    // Its config is read before the shop's lock: the block is checked in the reservation.
    expect((await checkout(cookie, 'coins-1')).json()).toEqual({ error: 'shop_blocked' });
  });
});

describe('el webhook', () => {
  test('sin firma válida no toca nada; los eventos del otro modo se ignoran', async () => {
    const { cookie, id } = await player();
    const p = await opened(cookie, 'coins-3');
    gateway.pay(p);
    expect((await deliver(gateway.webhook('checkout.session.completed', p, { badSignature: true }))).json()).toEqual({ error: 'invalid_signature' });
    expect((await deliver({ body: '{}', signature: 'x' })).json()).toEqual({ error: 'invalid_signature' });
    expect((await deliver(gateway.webhook('checkout.session.completed', p, { livemode: false }))).statusCode).toBe(200);
    expect((await getWallet(ctx.db, id)).coins).toBe(0);
  });

  test('entrega también en mantenimiento', async () => {
    const maint = await testApp({ now: () => clock, config: fixedConfig({ shop: SHOP, features: { maintenance: true } }), shopGateway: gateway });
    try {
      const { cookie, id } = await player();
      const p = await opened(cookie, 'dust-4');
      gateway.pay(p);
      expect((await deliver(gateway.webhook('checkout.session.completed', p), maint.app)).statusCode).toBe(200);
      expect((await getWallet(ctx.db, id)).dust).toBe(2650 * 2);
    } finally {
      await maint.close();
    }
  });
});

describe('la tienda cerrada', () => {
  test('sin Stripe, apagada o solo para el staff, no se ve ni se compra', async () => {
    const cases = [
      { config: fixedConfig({ shop: SHOP }), shopGateway: null },
      { config: fixedConfig({ shop: { ...SHOP, enabled: false } }), shopGateway: gateway },
      { config: fixedConfig({ shop: { ...SHOP, audience: 'staff' } }), shopGateway: gateway },
    ];
    for (const c of cases) {
      const app = await testApp({ now: () => clock, ...c });
      try {
        const res = await post(app.app, '/galaxy/api/auth/register', { username: uniqueName('shc'), password: 'una-clave-larga' });
        const cookie = sessionCookie(res);
        expect(await view(cookie, app.app)).toMatchObject({ open: false, closed: 'closed', publishableKey: null, products: [] });
        expect((await checkout(cookie, 'coins-1', {}, randomUUID(), app.app)).json()).toEqual({ error: 'shop_closed' });
      } finally {
        await app.close();
      }
    }
  });
});
