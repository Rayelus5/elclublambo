import { expect, test } from 'vitest';
import { DEFAULT_SHOP_PRODUCTS, referencePrice } from '../src/index';

// The «antes» price of a sale (EU Omnibus): the lowest price of the 30 days before the sale, from the shop config's
// history; only while the shop was open; nothing struck without it.

// An open shop needs a Stripe price on every product.
const products = (over: Record<string, unknown> = {}) =>
  DEFAULT_SHOP_PRODUCTS.map((p, i) => ({ ...p, stripePriceId: `price_${i}a` })).map((p) => (p.id === 'coins-4' ? { ...p, ...over } : p));
const v = (at: string, data: Record<string, unknown>) => ({ at: new Date(at), data: { enabled: false, ...data, products: data.products ?? products() } });
const sale = new Date('2026-12-20T00:00:00Z');

test('el más bajo de los 30 días anteriores a la oferta, con la tienda abierta', () => {
  const history = [
    v('2026-11-01T00:00:00Z', { enabled: true, products: products({ priceCents: 2299 }) }),
    v('2026-11-25T00:00:00Z', { enabled: true }),
    v('2026-12-10T00:00:00Z', { enabled: true, products: products({ priceCents: 2699 }) }),
  ];
  // 2299 ended on 25 Nov, inside the window (from 20 Nov).
  expect(referencePrice(history, 'coins-4', sale)).toBe(2299);
  // A later sale: 2299 is now more than 30 days back.
  expect(referencePrice(history, 'coins-4', new Date('2026-12-30T00:00:00Z'))).toBe(2499);
});

test('una rebaja anterior dentro de la ventana también cuenta', () => {
  const offer = { kind: 'price', priceCents: 1999, stripePriceId: 'price_x', startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-05T00:00:00.000Z' };
  const history = [v('2026-11-01T00:00:00Z', { enabled: true, products: products({ offer }) })];
  expect(referencePrice(history, 'coins-4', sale)).toBe(1999);
  // The sale itself (starting at its start) is not part of its own window.
  const own = { ...offer, startsAt: '2026-12-20T00:00:00.000Z', endsAt: '2026-12-27T00:00:00.000Z' };
  expect(referencePrice([v('2026-11-01T00:00:00Z', { enabled: true, products: products({ offer: own }) })], 'coins-4', sale)).toBe(2499);
});

test('sin tienda abierta ni producto en la ventana, no hay precio de antes', () => {
  expect(referencePrice([], 'coins-4', sale)).toBeNull();
  expect(referencePrice([v('2026-11-01T00:00:00Z', { enabled: false })], 'coins-4', sale)).toBeNull();
  expect(referencePrice([v('2026-11-01T00:00:00Z', { enabled: true })], 'no-existe', sale)).toBeNull();
  // Opened only after the sale started.
  expect(referencePrice([v('2026-12-21T00:00:00Z', { enabled: true })], 'coins-4', sale)).toBeNull();
  // A version that no longer reads is skipped.
  expect(referencePrice([{ at: new Date('2026-11-01T00:00:00Z'), data: { enabled: 'mal' } }], 'coins-4', sale)).toBeNull();
});
