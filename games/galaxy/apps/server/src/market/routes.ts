import { marketIdParamSchema, marketListSchema, type MarketOffersView, marketOfferSchema, marketQuerySchema, type MarketPage, type MarketStats, type MyMarket } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { requireFeature } from '../config/features';
import { hitRateLimit } from '../ratelimit';
import { withNotices } from '../realtime/notices';
import { inTransaction } from '../db/tx';
import { acceptOffer, makeOffer, myOffers, rejectOffer, withdrawOffer } from './offers';
import { browseMarket, buyListing, cancelListing, listGalaxy, type MarketDeps, marketConfigs, marketStats, myMarket } from './service';

// The market's routes (GDD §14.6; M5c-1). Listing and buying are idempotent operations (the configs are read before
// them: inside, a second connection must not be taken).

export function registerMarketRoutes(api: FastifyInstance, deps: MarketDeps): void {
  api.get('/galaxy/api/market', async (req): Promise<MarketPage> => {
    const s = requireSession(req);
    return browseMarket(deps, s.accountId, marketQuerySchema.parse(req.query));
  });

  // The market's public numbers (2026-11-14), as its job last counted them.
  api.get('/galaxy/api/market/stats', async (req): Promise<MarketStats> => {
    requireSession(req);
    return marketStats(deps);
  });

  api.get('/galaxy/api/market/mine', async (req): Promise<MyMarket> => {
    const s = requireSession(req);
    return myMarket(deps, s.accountId);
  });

  api.post('/galaxy/api/market/listings', async (req) => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'market');
    const body = marketListSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    const cfgs = await marketConfigs(deps);
    return runOperation(deps.db, s.accountId, key, 'market.list', requestHash(body), (trx) => listGalaxy(cfgs, trx, s.accountId, body, deps.now()));
  });

  api.post('/galaxy/api/market/listings/:id/cancel', async (req) => {
    const s = requireSession(req);
    const { id } = marketIdParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    return cancelListing(deps, s.accountId, id);
  });

  api.post('/galaxy/api/market/listings/:id/buy', async (req) => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'market');
    const { id } = marketIdParamSchema.parse(req.params);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    const cfgs = await marketConfigs(deps);
    return withNotices(deps.live, (out) => runOperation(deps.db, s.accountId, key, 'market.buy', requestHash({ id }), (trx) => buyListing(cfgs, trx, s.accountId, id, deps.now(), key, out)));
  });

  // Offers on listings (the owner, 2026-11-14): their coins are held until they end.
  api.get('/galaxy/api/market/offers', async (req): Promise<MarketOffersView> => {
    const s = requireSession(req);
    return myOffers(deps.db, s.accountId);
  });

  api.post('/galaxy/api/market/listings/:id/offers', async (req) => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'market');
    await requireFeature(deps.config, 'offers');
    const { id } = marketIdParamSchema.parse(req.params);
    const { amount } = marketOfferSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'offer', 30, 60);
    const cfgs = await marketConfigs(deps);
    return withNotices(deps.live, (out) =>
      runOperation(deps.db, s.accountId, key, 'market.offer', requestHash({ id, amount }), (trx) => makeOffer(cfgs, trx, s.accountId, id, amount, deps.now(), key, out)),
    );
  });

  api.post('/galaxy/api/market/offers/:id/accept', async (req) => {
    const s = requireSession(req);
    await requireFeature(deps.config, 'market');
    const { id } = marketIdParamSchema.parse(req.params);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    const cfgs = await marketConfigs(deps);
    return withNotices(deps.live, (out) => runOperation(deps.db, s.accountId, key, 'market.accept', requestHash({ id }), (trx) => acceptOffer(cfgs, trx, s.accountId, id, deps.now(), key, out)));
  });

  api.post('/galaxy/api/market/offers/:id/reject', async (req) => {
    const s = requireSession(req);
    const { id } = marketIdParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    return withNotices(deps.live, (out) => inTransaction(deps.db, (trx) => rejectOffer(trx, s.accountId, id, deps.now(), out)));
  });

  api.post('/galaxy/api/market/offers/:id/withdraw', async (req) => {
    const s = requireSession(req);
    const { id } = marketIdParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    return inTransaction(deps.db, (trx) => withdrawOffer(trx, s.accountId, id, deps.now()));
  });
}
