import Stripe from 'stripe';
import type { StripeEnv } from '../env';
import type { CheckoutInput, GatewayCharge, GatewayDispute, GatewayEvent, GatewayPrice, GatewaySession, ShopGateway } from './gateway';

// The real gateway (shop and lab plan, F4), on Stripe's official SDK with its version pinned (the SDK and the API it
// speaks: a new Stripe API never reaches the shop without a change here, and the webhook is set to the same version).
// Checkout Sessions with Elements: the server makes the session with the Stripe price of the product (never an amount
// sent by the browser) and the browser shows Stripe's payment form with its client secret. Card only, which includes
// Apple Pay and Google Pay.

/** The Stripe API version this code speaks (the SDK's own; the webhook endpoint must use the same). */
export const STRIPE_API_VERSION = '2026-10-28.endive';

const SESSION_STATUSES = new Set(['open', 'complete', 'expired']);
const PAYMENT_STATUSES = new Set(['paid', 'unpaid', 'no_payment_required']);

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === 'string' ? v : v.id;
}

/** Stripe's session, as the shop reads it. */
export function sessionOf(s: Stripe.Checkout.Session): GatewaySession {
  return {
    id: s.id,
    status: SESSION_STATUSES.has(s.status ?? '') ? (s.status as GatewaySession['status']) : 'open',
    paymentStatus: PAYMENT_STATUSES.has(s.payment_status) ? (s.payment_status as GatewaySession['paymentStatus']) : 'unpaid',
    amountTotal: s.amount_total ?? null,
    currency: s.currency ?? null,
    paymentIntent: idOf(s.payment_intent),
    livemode: s.livemode,
    metadata: { ...(s.metadata ?? {}) },
  };
}

export function chargeOf(c: Stripe.Charge): GatewayCharge {
  return { id: c.id, paymentIntent: idOf(c.payment_intent), amount: c.amount, amountRefunded: c.amount_refunded, currency: c.currency };
}

export function disputeOf(d: Stripe.Dispute): GatewayDispute {
  return { id: d.id, charge: idOf(d.charge), paymentIntent: idOf(d.payment_intent), amount: d.amount, status: d.status, reason: d.reason };
}

/** An event's object as the shop reads it (a session, a charge or a dispute; the rest is left as it is). */
export function eventOf(e: { id: string; type: string; livemode: boolean; data: { object: unknown } }): GatewayEvent {
  const object = e.data.object as Record<string, unknown>;
  const kind = object.object;
  return {
    id: e.id,
    type: e.type,
    livemode: e.livemode,
    object,
    session: kind === 'checkout.session' ? sessionOf(object as unknown as Stripe.Checkout.Session) : null,
    charge: kind === 'charge' ? chargeOf(object as unknown as Stripe.Charge) : null,
    dispute: kind === 'dispute' ? disputeOf(object as unknown as Stripe.Dispute) : null,
  };
}

export function createStripeGateway(env: StripeEnv): ShopGateway {
  const stripe = new Stripe(env.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 15_000,
    appInfo: { name: 'galaxy-survivor-shop' },
  });
  return {
    mode: env.mode,
    publishableKey: env.publishableKey,
    async createCheckoutSession(input: CheckoutInput) {
      const metadata = { purchase: input.purchaseId, account: input.accountId, product: input.productId };
      const session = await stripe.checkout.sessions.create(
        {
          ui_mode: 'elements',
          mode: 'payment',
          line_items: [{ price: input.priceId, quantity: 1 }],
          // A filter on what Stripe offers: card alone (Apple Pay and Google Pay are cards' wallets).
          allowed_payment_method_types: ['card'],
          return_url: input.returnUrl,
          client_reference_id: input.accountId,
          metadata,
          payment_intent_data: { metadata, description: `Galaxy Survivor: ${input.productName}` },
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
          locale: 'es',
        },
        // The same purchase never opens two sessions, even when the call is repeated.
        { idempotencyKey: `galaxy-purchase-${input.purchaseId}` },
      );
      if (!session.client_secret) throw new Error('stripe_session_without_secret');
      return { id: session.id, clientSecret: session.client_secret };
    },
    async retrieveCheckoutSession(id: string): Promise<GatewaySession> {
      return sessionOf(await stripe.checkout.sessions.retrieve(id));
    },
    async expireCheckoutSession(id: string): Promise<GatewaySession> {
      try {
        return sessionOf(await stripe.checkout.sessions.expire(id));
      } catch (err) {
        // Stripe only expires open sessions: one already paid or expired is just read.
        const s = sessionOf(await stripe.checkout.sessions.retrieve(id));
        if (s.status !== 'open') return s;
        throw err;
      }
    },
    async retrievePrice(id: string): Promise<GatewayPrice> {
      const p = await stripe.prices.retrieve(id);
      return { id: p.id, unitAmount: p.unit_amount ?? null, currency: p.currency, active: p.active, livemode: p.livemode, oneTime: p.type === 'one_time' };
    },
    async createPrice(input) {
      const price = await stripe.prices.create(
        {
          currency: 'eur',
          unit_amount: input.cents,
          product_data: { name: `Galaxy Survivor: ${input.name}`, metadata: { product: input.productId } },
          metadata: { product: input.productId },
        },
        { idempotencyKey: `galaxy-price-${input.productId}-${input.cents}` },
      );
      return { id: price.id };
    },
    verifyWebhook(rawBody: Buffer, signature: string): GatewayEvent {
      return eventOf(stripe.webhooks.constructEvent(rawBody, signature, env.webhookSecret));
    },
  };
}
