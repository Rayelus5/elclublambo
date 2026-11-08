import { marketIdParamSchema, marketListSchema, marketQuerySchema, type MarketPage, type MyMarket } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { browseMarket, buyListing, cancelListing, listGalaxy, type MarketDeps, marketConfigs, myMarket } from './service';

// The market's routes (GDD §14.6; M5c-1). Listing and buying are idempotent operations (the configs are read before
// them: inside, a second connection must not be taken).

export function registerMarketRoutes(api: FastifyInstance, deps: MarketDeps): void {
  api.get('/galaxy/api/market', async (req): Promise<MarketPage> => {
    const s = requireSession(req);
    return browseMarket(deps, s.accountId, marketQuerySchema.parse(req.query));
  });

  api.get('/galaxy/api/market/mine', async (req): Promise<MyMarket> => {
    const s = requireSession(req);
    return myMarket(deps, s.accountId);
  });

  api.post('/galaxy/api/market/listings', async (req) => {
    const s = requireSession(req);
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
    const { id } = marketIdParamSchema.parse(req.params);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'market', 60, 60);
    const cfgs = await marketConfigs(deps);
    return runOperation(deps.db, s.accountId, key, 'market.buy', requestHash({ id }), (trx) => buyListing(cfgs, trx, s.accountId, id, deps.now(), key));
  });
}
