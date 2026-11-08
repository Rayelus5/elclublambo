import { type MyTrades, tradeConfirmSchema, tradeIdParamSchema, tradeOfferSchema, tradeProposeSchema, type TradeView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/guards';
import { inTransaction } from '../db/tx';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { type MarketDeps, marketConfigs } from './service';
import { cancelTrade, changeTrade, confirmTrade, myTrades, proposeTrade } from './trades';

// The swaps' routes (GDD §14.5; M5c-2). Proposing is an idempotent operation; changing and confirming name the version
// the player saw, so a retry of either is answered by the version check. The configs are read before the transaction.

export function registerTradeRoutes(api: FastifyInstance, deps: MarketDeps): void {
  api.get('/galaxy/api/trades', async (req): Promise<MyTrades> => {
    const s = requireSession(req);
    return myTrades(deps, s.accountId);
  });

  api.post('/galaxy/api/trades', async (req): Promise<TradeView> => {
    const s = requireSession(req);
    const body = tradeProposeSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'trade', 60, 60);
    const cfgs = await marketConfigs(deps);
    return runOperation(deps.db, s.accountId, key, 'trade.propose', requestHash(body), (trx) => proposeTrade(cfgs, trx, s.accountId, body, deps.now()));
  });

  api.post('/galaxy/api/trades/:id/offer', async (req): Promise<TradeView> => {
    const s = requireSession(req);
    const { id } = tradeIdParamSchema.parse(req.params);
    const body = tradeOfferSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'trade', 60, 60);
    const cfgs = await marketConfigs(deps);
    return inTransaction(deps.db, (trx) => changeTrade(cfgs, trx, s.accountId, id, body, deps.now()));
  });

  api.post('/galaxy/api/trades/:id/confirm', async (req): Promise<TradeView> => {
    const s = requireSession(req);
    const { id } = tradeIdParamSchema.parse(req.params);
    const { version } = tradeConfirmSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'trade', 60, 60);
    const cfgs = await marketConfigs(deps);
    return inTransaction(deps.db, (trx) => confirmTrade(cfgs, trx, s.accountId, id, version, deps.now()));
  });

  api.post('/galaxy/api/trades/:id/cancel', async (req): Promise<TradeView> => {
    const s = requireSession(req);
    const { id } = tradeIdParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'trade', 60, 60);
    return cancelTrade(deps, s.accountId, id);
  });
}
