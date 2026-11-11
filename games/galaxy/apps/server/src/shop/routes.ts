import { shopCheckoutSchema, type ShopCheckout, type ShopPurchaseView, type ShopView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { HttpError } from '../errors';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { applyDispute, applyRefund } from './aftersale';
import type { GatewayEvent } from './gateway';
import { applySession, openCheckout, purchaseOfSession, purchaseStatus, type ShopDeps, shopView } from './service';

// The resource shop's routes (shop and lab plan, F4). The webhook is Stripe's: no session and no Origin (its route is
// exempt from the CSRF guard and open during maintenance), its raw body is read as bytes for the signature, which is
// checked before anything touches the database; events of the other mode are ignored, and each event is handled once.
// It hears the payments (checkout.session.*), refunds (charge.refunded) and disputes (charge.dispute.created/closed).

export const WEBHOOK_PATH = '/galaxy/api/shop/webhook';
const purchaseParam = z.object({ id: z.uuid() }).strict();

export function registerShopRoutes(api: FastifyInstance, deps: ShopDeps): void {
  api.get('/galaxy/api/shop', async (req): Promise<ShopView> => {
    const s = requireSession(req);
    return shopView(deps, s);
  });

  api.post('/galaxy/api/shop/checkout', async (req): Promise<ShopCheckout> => {
    const s = requireSession(req);
    const body = shopCheckoutSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'shop_checkout', 10, 600);
    // The config is read now, not inside the transaction.
    await deps.config.get('shop');
    return openCheckout(deps, s, body, key, requestHash(body));
  });

  api.get('/galaxy/api/shop/purchases/:id', async (req): Promise<ShopPurchaseView> => {
    const s = requireSession(req);
    const { id } = purchaseParam.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'shop_purchase', 120, 60);
    return purchaseStatus(deps, s.accountId, id);
  });

  // Stripe's webhook, in a plugin of its own: JSON is read as bytes there (its signature is over the exact body).
  void api.register(async (hook) => {
    hook.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    hook.post(WEBHOOK_PATH, { config: { originExempt: true }, bodyLimit: 1024 * 1024 }, async (req, reply) => {
      const gateway = deps.gateway;
      if (!gateway) throw new HttpError(503, 'payment_unavailable');
      const signature = req.headers['stripe-signature'];
      if (typeof signature !== 'string' || !Buffer.isBuffer(req.body)) throw new HttpError(400, 'invalid_signature');
      let event: GatewayEvent;
      try {
        event = gateway.verifyWebhook(req.body, signature);
      } catch {
        throw new HttpError(400, 'invalid_signature');
      }
      if (event.livemode !== (gateway.mode === 'live')) return reply.send({ received: true });
      const seen = await deps.db.selectFrom('galaxy.shop_stripe_events').select('id').where('id', '=', event.id).executeTakeFirst();
      if (seen) return reply.send({ received: true });
      const purchase = await handleEvent(deps, event);
      // Kept after it was handled: one that failed comes again (Stripe retries) and every step is idempotent.
      await deps.db
        .insertInto('galaxy.shop_stripe_events')
        .values({ id: event.id, type: event.type.slice(0, 80), purchase_id: purchase })
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      return reply.send({ received: true });
    });
  });
}

/** One Stripe event; returns the purchase it was about (null: none of the shop's). */
async function handleEvent(deps: ShopDeps, event: GatewayEvent): Promise<string | null> {
  if (event.type === 'charge.refunded' && event.charge) return applyRefund(deps, event.charge);
  if (event.type === 'charge.dispute.created' && event.dispute) return applyDispute(deps, event.dispute, false);
  if (event.type === 'charge.dispute.closed' && event.dispute) return applyDispute(deps, event.dispute, true);
  const session = event.session;
  if (!session || !event.type.startsWith('checkout.session.')) return null;
  const purchase = await purchaseOfSession(deps.db, session);
  if (!purchase) return null;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired':
      await applySession(deps, purchase, session);
      break;
    case 'checkout.session.async_payment_failed':
      await applySession(deps, purchase, session, true);
      break;
  }
  return purchase;
}
