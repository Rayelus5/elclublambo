import { expect, test } from 'vitest';
import { priceMatches } from '../../src/shop/service';
import { fakeGateway } from '../fake-gateway';

// The shop's gateway without network (shop and lab plan, F4): a webhook is checked with Stripe's own signature code and
// read as a Checkout Session; a Stripe price only charges when it is the one shown, in euros, one-off and active.

test('un webhook firmado se lee como sesión; con otra firma, no', async () => {
  const g = fakeGateway();
  g.setPrice('price_a', 399);
  const { id } = await g.createCheckoutSession({ purchaseId: '00000000-0000-4000-8000-000000000001', accountId: 'a', productId: 'coins-1', productName: 'x', priceId: 'price_a', returnUrl: 'https://x', expiresAt: new Date() });
  g.pay('00000000-0000-4000-8000-000000000001');
  const w = g.webhook('checkout.session.completed', '00000000-0000-4000-8000-000000000001');
  const e = g.verifyWebhook(Buffer.from(w.body), w.signature);
  expect(e).toMatchObject({ type: 'checkout.session.completed', livemode: true });
  expect(e.session).toMatchObject({ id, status: 'complete', paymentStatus: 'paid', amountTotal: 399, currency: 'eur', metadata: { purchase: '00000000-0000-4000-8000-000000000001', product: 'coins-1' } });
  expect(e.session!.paymentIntent).toMatch(/^pi_/);
  const bad = g.webhook('checkout.session.completed', '00000000-0000-4000-8000-000000000001', { badSignature: true });
  expect(() => g.verifyWebhook(Buffer.from(bad.body), bad.signature)).toThrow();
  // A body changed after signing does not hold either.
  expect(() => g.verifyWebhook(Buffer.from(w.body.replace('"paid"', '"unpaid"')), w.signature)).toThrow();
});

test('el precio de Stripe cobra solo si es el mostrado', () => {
  const p = { id: 'price_a', unitAmount: 399, currency: 'eur', active: true, livemode: true, oneTime: true };
  expect(priceMatches(p, 399, 'live')).toBe(true);
  expect(priceMatches(p, 499, 'live')).toBe(false);
  expect(priceMatches({ ...p, currency: 'usd' }, 399, 'live')).toBe(false);
  expect(priceMatches({ ...p, active: false }, 399, 'live')).toBe(false);
  expect(priceMatches({ ...p, oneTime: false }, 399, 'live')).toBe(false);
  expect(priceMatches(p, 399, 'test')).toBe(false);
});
