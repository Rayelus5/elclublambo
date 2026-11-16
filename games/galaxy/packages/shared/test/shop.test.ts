import { describe, expect, test } from 'vitest';
import {
  activeOffer,
  configIssues,
  DEFAULT_SHOP_PRODUCTS,
  effectivePrice,
  parseConfig,
  productBlock,
  productTab,
  purchaseGrants,
  shopCheckoutSchema,
  shopOpenFor,
  type ShopProduct,
} from '../src/index';

// The resource shop (shop and lab plan, F4): a live catalogue born closed, six packs of each currency, bundles and the
// welcome pack, never scanner signals; offers of «+X % de regalo» or of a lower price with its own Stripe price; the
// first purchase of a pack gives more; an open shop charges every product with a Stripe price.

const shop = parseConfig('shop', {});
const product = (id: string) => shop.products.find((p) => p.id === id)!;
const messages = (data: unknown) => configIssues('shop', data).map((i) => i.message);
const at = (iso: string) => new Date(iso);
const withPrices = (products: ShopProduct[]) => products.map((p, i) => ({ ...p, stripePriceId: `price_${i}abc` }));

describe('el catálogo', () => {
  test('nace cerrado y solo para el staff, con seis packs de cada recurso, tres combinados y el de bienvenida', () => {
    expect(shop.enabled).toBe(false);
    expect(shop.audience).toBe('staff');
    for (const tab of ['coins', 'dust', 'components'] as const) {
      const packs = shop.products.filter((p) => productTab(p) === tab);
      expect(packs).toHaveLength(6);
      // Bigger packs are better value: more given per euro at every step.
      const value = packs.map((p) => (p.grants[tab] + p.bonus[tab]) / p.priceCents);
      for (let i = 1; i < value.length; i++) expect(value[i]).toBeGreaterThan(value[i - 1]!);
    }
    expect(shop.products.filter((p) => p.kind === 'bundle')).toHaveLength(3);
    expect(shop.products.filter((p) => p.kind === 'welcome')).toEqual([expect.objectContaining({ maxPerAccount: 1, priceCents: 199 })]);
    expect(shop.products).toEqual(DEFAULT_SHOP_PRODUCTS);
  });

  test('ningún producto puede dar señales del escáner', () => {
    expect(messages({ products: [{ ...product('coins-1'), grants: { coins: 500, signal: 3 } }] })).not.toEqual([]);
  });

  test('ids y precios de Stripe una sola vez; un pack da un solo recurso; algo tiene que dar', () => {
    const coins = product('coins-1');
    expect(messages({ products: [coins, coins] })).toContain('Hay dos productos con el id coins-1');
    expect(messages({ products: [{ ...coins, stripePriceId: 'price_A' }, { ...product('dust-1'), stripePriceId: 'price_A' }] })).toContain('El precio de Stripe price_A ya lo usa coins-1');
    expect(messages({ products: [{ ...coins, grants: { coins: 500, dust: 10 } }] })).toContain('Un pack da un solo recurso (para varios, un pack combinado)');
    expect(messages({ products: [{ ...coins, grants: {}, bonus: {} }] })).toContain('No da nada');
    expect(messages({ products: [{ ...product('welcome'), maxPerAccount: 2 }] })).toContain('El pack de bienvenida se compra una vez');
  });

  test('abierta, cada producto activo cobra con su precio de Stripe; nada cuesta más que el límite diario', () => {
    expect(messages({ enabled: true })).toContain('Con la tienda abierta, coins-1 necesita su precio de Stripe');
    expect(messages({ enabled: true, products: withPrices(shop.products) })).toEqual([]);
    expect(messages({ enabled: true, products: withPrices(shop.products).map((p) => (p.id === 'coins-1' ? p : { ...p, enabled: false, stripePriceId: null })) })).toEqual([]);
    expect(messages({ limits: { dailyCents: 5000 } })).toContain('coins-6 cuesta más que el límite diario');
  });

  test('una oferta de precio baja el precio y trae el suyo; dura 31 días como mucho', () => {
    const offer = { kind: 'price', priceCents: 1499, stripePriceId: 'price_off', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-08T00:00:00.000Z' };
    expect(messages({ products: [{ ...product('coins-4'), offer }] })).toEqual([]);
    expect(messages({ products: [{ ...product('coins-4'), offer: { ...offer, priceCents: 2499 } }] })).toContain('El precio de oferta debe ser menor que el normal');
    expect(messages({ products: [{ ...product('coins-4'), offer: { ...offer, endsAt: '2027-01-08T00:00:00.000Z' } }] })).toContain('Una oferta dura 31 días como mucho');
  });
});

describe('lo que cuesta y lo que da', () => {
  const sale = { ...product('coins-3'), offer: { kind: 'price' as const, priceCents: 999, stripePriceId: 'price_sale', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-08T00:00:00.000Z' } };
  const gift = { ...product('dust-2'), offer: { kind: 'bonus' as const, percent: 50, startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-08T00:00:00.000Z' } };

  test('la oferta vale de su inicio a su fin, sin incluirlo', () => {
    expect(activeOffer(sale, at('2026-11-30T23:59:59Z'))).toBeNull();
    expect(activeOffer(sale, at('2026-12-01T00:00:00Z'))).not.toBeNull();
    expect(activeOffer(sale, at('2026-12-08T00:00:00Z'))).toBeNull();
  });

  test('con oferta de precio cobra el suyo con su precio de Stripe; sin ella, el normal', () => {
    expect(effectivePrice(sale, at('2026-12-02T00:00:00Z'))).toEqual({ cents: 999, stripePriceId: 'price_sale', endsAt: '2026-12-08T00:00:00.000Z' });
    expect(effectivePrice(sale, at('2026-12-09T00:00:00Z'))).toEqual({ cents: 1299, stripePriceId: null, endsAt: null });
    expect(effectivePrice(gift, at('2026-12-02T00:00:00Z'))).toEqual({ cents: 699, stripePriceId: null, endsAt: '2026-12-08T00:00:00.000Z' });
  });

  test('da lo suyo y su regalo; la primera compra y el «+X %» se suman sobre eso, redondeando hacia abajo', () => {
    const now = at('2026-12-02T00:00:00Z');
    expect(purchaseGrants(product('dust-2'), now, false, shop)).toEqual({ base: { coins: 0, dust: 600, components: 0 }, extra: { coins: 0, dust: 0, components: 0 }, total: { coins: 0, dust: 600, components: 0 } });
    expect(purchaseGrants(product('dust-2'), now, true, shop).total.dust).toBe(1200);
    expect(purchaseGrants(gift, now, false, shop).total.dust).toBe(900);
    expect(purchaseGrants(gift, now, true, shop).extra.dust).toBe(900);
    expect(purchaseGrants({ ...product('coins-2'), bonus: { coins: 0, dust: 0, components: 0 }, grants: { coins: 333, dust: 0, components: 0 } }, now, true, { firstPurchase: { enabled: true, percent: 50 } }).extra.coins).toBe(166);
    // Bundles and the welcome pack have no first-purchase extra, and it can be switched off.
    expect(purchaseGrants(product('kit-arranque'), now, true, shop).extra).toEqual({ coins: 0, dust: 0, components: 0 });
    expect(purchaseGrants(product('dust-2'), now, true, { firstPurchase: { enabled: false, percent: 100 } }).total.dust).toBe(600);
  });
});

describe('quién puede comprar', () => {
  test('lo apagado y lo del staff no se venden; lo de una vez, una vez', () => {
    expect(productBlock(product('coins-1'), { staff: false, bought: 9 })).toBeNull();
    expect(productBlock({ ...product('coins-1'), enabled: false }, { staff: true, bought: 0 })).toBe('unavailable');
    expect(productBlock({ ...product('coins-1'), staffOnly: true }, { staff: false, bought: 0 })).toBe('unavailable');
    expect(productBlock({ ...product('coins-1'), staffOnly: true }, { staff: true, bought: 0 })).toBeNull();
    expect(productBlock(product('welcome'), { staff: false, bought: 1 })).toBe('once_used');
    expect(productBlock({ ...product('kit-comandante'), maxPerAccount: 2 }, { staff: false, bought: 1 })).toBeNull();
  });

  test('abierta solo encendida, con sus claves y para su público', () => {
    expect(shopOpenFor({ enabled: false, audience: 'everyone' }, true, true)).toBe(false);
    expect(shopOpenFor({ enabled: true, audience: 'everyone' }, false, true)).toBe(false);
    expect(shopOpenFor({ enabled: true, audience: 'staff' }, true, false)).toBe(false);
    expect(shopOpenFor({ enabled: true, audience: 'staff' }, true, true)).toBe(true);
    expect(shopOpenFor({ enabled: true, audience: 'everyone' }, true, false)).toBe(true);
  });

  test('pagar pide la casilla marcada y la versión de las condiciones', () => {
    expect(shopCheckoutSchema.parse({ product: 'coins-1', consent: true, terms: 'v1' })).toEqual({ product: 'coins-1', consent: true, terms: 'v1' });
    expect(() => shopCheckoutSchema.parse({ product: 'coins-1', consent: false, terms: 'v1' })).toThrow();
    expect(() => shopCheckoutSchema.parse({ product: 'coins-1', terms: 'v1' })).toThrow();
  });
});

// Cosmetics for real money (Nov plan C5): avatars, frames and titles, each once per account, in the «Estilo» tab;
// born switched off, waiting for their Stripe prices.
describe('los cosméticos de la tienda', () => {
  const cosmetic = shop.products.filter((p) => p.kind === 'cosmetic');

  test('vienen 20, apagados, de 0,99 a 3,99 €, sin recursos y una vez por cuenta, en la pestaña Estilo', () => {
    expect(cosmetic).toHaveLength(20);
    for (const p of cosmetic) {
      expect(p.enabled).toBe(false);
      expect(p.priceCents).toBeGreaterThanOrEqual(99);
      // Plan «skins», C2: the Leyenda skins from 1,99 to 3,99 €.
      expect(p.priceCents).toBeLessThanOrEqual(p.cosmetic!.kind === 'skin' ? 399 : 299);
      if (p.cosmetic!.kind === 'skin') expect(p.priceCents).toBeGreaterThanOrEqual(199);
      expect(p.grants).toEqual({ coins: 0, dust: 0, components: 0 });
      expect(p.firstBonus).toBe(false);
      expect(productTab(p)).toBe('style');
      expect(productBlock({ ...p, enabled: true }, { staff: false, bought: 1 })).toBe('once_used');
    }
    expect(cosmetic.map((p) => p.cosmetic!.kind).sort()).toEqual([...Array(4).fill('avatar'), ...Array(4).fill('frame'), ...Array(8).fill('skin'), ...Array(4).fill('title')]);
  });

  test('un cosmético necesita su pieza, que exista su arte, y no da recursos', () => {
    const base = { ...cosmetic[0]!, enabled: true, stripePriceId: 'price_x1' };
    const issues = (p: object) => messages({ products: [p] });
    expect(issues({ ...base, cosmetic: null })).toContain('shop_cosmetic_piece');
    expect(issues({ ...base, cosmetic: { kind: 'avatar', id: 'no-existe' } })).toContain('shop_cosmetic_piece');
    expect(issues({ ...base, grants: { coins: 10, dust: 0, components: 0 } })).toContain('shop_cosmetic_grants');
    expect(issues({ ...product('coins-1'), cosmetic: { kind: 'frame', id: 'prism' } })).toContain('shop_cosmetic_piece');
  });
});

// Complete skin packs (2026-11-17): a `set` gives several pieces at once, sold whole, once per account, in the
// «Estilo» tab; any product can have a sales window (the Christmas pack only sells in December).
describe('los packs de piezas', () => {
  const leyenda = ['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo'].map((p) => ({ kind: 'skin' as const, id: `skin-${p}-leyenda` }));
  const set: ShopProduct = { ...product('style-skin-lumen'), id: 'skins-leyenda', kind: 'set', name: 'Pack Leyenda', cosmetic: null, pieces: leyenda, priceCents: 1699, enabled: false };
  const issues = (p: object) => messages({ products: [p] });

  test('un pack da sus piezas y nada más, una vez por cuenta, en la pestaña Estilo', () => {
    expect(issues(set)).toEqual([]);
    expect(productTab(set)).toBe('style');
    expect(productBlock({ ...set, enabled: true }, { staff: false, bought: 0 })).toBeNull();
    expect(productBlock({ ...set, enabled: true, maxPerAccount: null }, { staff: false, bought: 1 })).toBe('once_used');
  });

  test('un pack lleva de 2 a 12 piezas con arte, sin repetir, y solo un pack las lleva', () => {
    expect(issues({ ...set, pieces: leyenda.slice(0, 1) })).toContain('shop_set_pieces');
    expect(issues({ ...set, pieces: [...leyenda, ...leyenda.slice(0, 5)] })).toContain('shop_set_pieces');
    expect(issues({ ...set, pieces: [leyenda[0], leyenda[0]] })).toContain('shop_set_pieces');
    expect(issues({ ...set, pieces: [leyenda[0], { kind: 'skin', id: 'skin-lumen-nada' }] })).toContain('shop_set_pieces');
    expect(issues({ ...set, grants: { coins: 10, dust: 0, components: 0 } })).toContain('shop_cosmetic_grants');
    expect(issues({ ...set, cosmetic: leyenda[0] })).toContain('shop_cosmetic_piece');
    expect(issues({ ...product('coins-1'), pieces: leyenda })).toContain('shop_set_pieces');
    expect(issues({ ...product('style-skin-lumen'), pieces: leyenda })).toContain('shop_set_pieces');
  });

  test('las fechas de venta: fuera de ellas no se ve ni se compra', () => {
    const xmas = { ...set, enabled: true, availableFrom: '2026-11-30T23:00:00.000Z', availableUntil: '2027-01-06T23:00:00.000Z' };
    expect(issues(xmas)).toEqual([]);
    expect(productBlock(xmas, { staff: false, bought: 0, now: at('2026-11-30T22:59:59.000Z') })).toBe('unavailable');
    expect(productBlock(xmas, { staff: false, bought: 0, now: at('2026-11-30T23:00:00.000Z') })).toBeNull();
    expect(productBlock(xmas, { staff: false, bought: 0, now: at('2027-01-06T22:59:59.000Z') })).toBeNull();
    expect(productBlock(xmas, { staff: false, bought: 0, now: at('2027-01-06T23:00:00.000Z') })).toBe('unavailable');
    // Only one end is fine; an end before the start is not.
    expect(productBlock({ ...xmas, availableFrom: null }, { staff: false, bought: 0, now: at('2020-01-01T00:00:00.000Z') })).toBeNull();
    expect(issues({ ...xmas, availableUntil: '2026-11-01T00:00:00.000Z' })).toContain('shop_window');
  });

  test('lo que ya estaba publicado sigue valiendo: sin piezas ni fechas', () => {
    const old = { ...product('coins-1') } as Partial<ShopProduct>;
    delete old.pieces;
    delete old.availableFrom;
    delete old.availableUntil;
    const parsed = parseConfig('shop', { products: [old] });
    expect(parsed.products[0]).toMatchObject({ pieces: [], availableFrom: null, availableUntil: null });
  });
});
