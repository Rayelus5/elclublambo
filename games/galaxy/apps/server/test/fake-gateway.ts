import Stripe from 'stripe';
import type { CheckoutInput, GatewayPrice, GatewaySession, ShopGateway } from '../src/shop/gateway';
import { sessionOf, STRIPE_API_VERSION } from '../src/shop/stripe-gateway';

// A payment gateway for the shop's tests (shop and lab plan, F4): no network and no keys. Its sessions live in memory
// and are paid or expired by the test; its prices are the test's. Webhooks are signed and checked with Stripe's own
// code (the SDK's test header), so the signature path is the real one.

const SECRET = 'whsec_' + 'fakeSecretForTests';
// The SDK needs a key to be built; it never calls the network here.
const stripe = new Stripe('sk_test_' + 'fake', { apiVersion: STRIPE_API_VERSION });

interface FakeSession extends GatewaySession {
  clientSecret: string;
}

export interface FakeGateway extends ShopGateway {
  /** Every session opened, in order. */
  created: CheckoutInput[];
  sessions: Map<string, FakeSession>;
  prices: Map<string, GatewayPrice>;
  /** The next session opening fails (Stripe down). */
  failNext: boolean;
  /** Stripe's one-off euro price of `cents`. */
  setPrice(id: string, cents: number, over?: Partial<GatewayPrice>): void;
  sessionOfPurchase(purchase: string): FakeSession;
  /** The player pays the purchase's session (Stripe's state; no webhook sent). */
  pay(purchase: string, over?: Partial<GatewaySession>): FakeSession;
  expire(purchase: string): FakeSession;
  /** A signed webhook about the purchase's session, as Stripe sends it. */
  webhook(type: string, purchase: string, opts?: { id?: string; livemode?: boolean; badSignature?: boolean }): { body: string; signature: string };
}

let n = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(n++).toString(36)}`;

/** Stripe's raw Checkout Session, as it comes in a webhook. */
function rawSession(s: GatewaySession) {
  return {
    id: s.id,
    object: 'checkout.session',
    status: s.status,
    payment_status: s.paymentStatus,
    amount_total: s.amountTotal,
    currency: s.currency,
    payment_intent: s.paymentIntent,
    livemode: s.livemode,
    metadata: s.metadata,
  };
}

export function fakeGateway(mode: 'live' | 'test' = 'live'): FakeGateway {
  const sessions = new Map<string, FakeSession>();
  const byPurchase = new Map<string, string>();
  const prices = new Map<string, GatewayPrice>();
  const g: FakeGateway = {
    mode,
    publishableKey: `pk_${mode}_fake`,
    created: [],
    sessions,
    prices,
    failNext: false,
    setPrice(id, cents, over = {}) {
      prices.set(id, { id, unitAmount: cents, currency: 'eur', active: true, livemode: mode === 'live', oneTime: true, ...over });
    },
    async createCheckoutSession(input) {
      g.created.push(input);
      if (g.failNext) {
        g.failNext = false;
        throw new Error('stripe_down');
      }
      // Stripe's idempotency: the same purchase gets the same session.
      const known = byPurchase.get(input.purchaseId);
      if (known) return { id: known, clientSecret: sessions.get(known)!.clientSecret };
      const id = nextId('cs');
      const price = prices.get(input.priceId);
      sessions.set(id, {
        id,
        clientSecret: `${id}_secret_fake`,
        status: 'open',
        paymentStatus: 'unpaid',
        amountTotal: price?.unitAmount ?? null,
        currency: 'eur',
        paymentIntent: null,
        livemode: mode === 'live',
        metadata: { purchase: input.purchaseId, account: input.accountId, product: input.productId },
      });
      byPurchase.set(input.purchaseId, id);
      return { id, clientSecret: `${id}_secret_fake` };
    },
    async retrieveCheckoutSession(id) {
      const s = sessions.get(id);
      if (!s) throw new Error('no_such_session');
      const { clientSecret: _secret, ...rest } = s;
      return { ...rest, metadata: { ...rest.metadata } };
    },
    async retrievePrice(id) {
      const p = prices.get(id);
      if (!p) throw new Error('no_such_price');
      return p;
    },
    verifyWebhook(rawBody, signature) {
      const e = stripe.webhooks.constructEvent(rawBody, signature, SECRET);
      const object = e.data.object as unknown as Record<string, unknown>;
      return { id: e.id, type: e.type, livemode: e.livemode, object, session: object.object === 'checkout.session' ? sessionOf(object as unknown as Stripe.Checkout.Session) : null };
    },
    sessionOfPurchase(purchase) {
      const id = byPurchase.get(purchase);
      if (!id) throw new Error(`no session for ${purchase}`);
      return sessions.get(id)!;
    },
    pay(purchase, over = {}) {
      const s = g.sessionOfPurchase(purchase);
      Object.assign(s, { status: 'complete', paymentStatus: 'paid', paymentIntent: nextId('pi'), ...over });
      return s;
    },
    expire(purchase) {
      const s = g.sessionOfPurchase(purchase);
      s.status = 'expired';
      return s;
    },
    webhook(type, purchase, opts = {}) {
      const s = g.sessionOfPurchase(purchase);
      const body = JSON.stringify({
        id: opts.id ?? nextId('evt'),
        object: 'event',
        api_version: STRIPE_API_VERSION,
        type,
        livemode: opts.livemode ?? mode === 'live',
        created: Math.floor(Date.now() / 1000),
        data: { object: rawSession(s) },
      });
      const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: opts.badSignature ? `${SECRET}x` : SECRET });
      return { body, signature };
    },
  };
  return g;
}
