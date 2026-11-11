// The resource shop's payment gateway (shop and lab plan, F4): the few things the shop asks of Stripe, behind an
// interface so the tests use a fake one (no network, no keys) and the server builds the real one from its env
// (stripe-gateway.ts). Only what the shop reads is mapped: amounts in cents, the session's state, the event's object.

export interface GatewaySession {
  id: string;
  /** Stripe's: open (not paid yet), complete or expired. */
  status: 'open' | 'complete' | 'expired';
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  amountTotal: number | null;
  currency: string | null;
  paymentIntent: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
}

export interface GatewayPrice {
  id: string;
  unitAmount: number | null;
  currency: string;
  active: boolean;
  livemode: boolean;
  /** One-off (not a subscription). */
  oneTime: boolean;
}

export interface GatewayEvent {
  id: string;
  type: string;
  livemode: boolean;
  /** `data.object` of the event (a session, a charge, a dispute…). */
  object: Record<string, unknown>;
  /** The object read as a Checkout Session, when it is one. */
  session: GatewaySession | null;
}

export interface CheckoutInput {
  purchaseId: string;
  accountId: string;
  productId: string;
  productName: string;
  priceId: string;
  /** Where Stripe sends the player after a payment that needs a redirect (3-D Secure in another page). */
  returnUrl: string;
  expiresAt: Date;
}

export interface ShopGateway {
  mode: 'live' | 'test';
  publishableKey: string;
  createCheckoutSession(input: CheckoutInput): Promise<{ id: string; clientSecret: string }>;
  retrieveCheckoutSession(id: string): Promise<GatewaySession>;
  retrievePrice(id: string): Promise<GatewayPrice>;
  /** Checks the signature of a webhook's raw body and reads it; throws when it does not hold. */
  verifyWebhook(rawBody: Buffer, signature: string): GatewayEvent;
}
