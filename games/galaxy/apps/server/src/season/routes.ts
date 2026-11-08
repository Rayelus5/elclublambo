import { seasonItemParamsSchema, seasonStepParamsSchema, type SeasonView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { buyItem, claimStep, convertLeftovers, seasonConfigs, seasonScore, seasonView } from './service';

// The season's routes (GDD §13.1; M7d-1): the route and shop, collecting a step and buying an item (both idempotent).

export function registerSeasonRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader; now: () => Date }): void {
  api.get('/galaxy/api/season', async (req): Promise<SeasonView> => {
    const s = requireSession(req);
    const now = deps.now();
    const c = await seasonConfigs(deps.config);
    await convertLeftovers(deps.db, c, s.accountId, now);
    return seasonView(deps.db, c, s.accountId, await seasonScore(deps.db, c, s.accountId, now), now);
  });

  api.post('/galaxy/api/season/route/:at/claim', async (req): Promise<SeasonView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { at } = seasonStepParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    const now = deps.now();
    const c = await seasonConfigs(deps.config);
    const score = await seasonScore(deps.db, c, s.accountId, now);
    return runOperation(deps.db, s.accountId, key, 'season.claim', requestHash({ at }), async (trx) => {
      await claimStep(trx, c, s.accountId, at, score, key, now);
      return seasonView(trx, c, s.accountId, score, now);
    });
  });

  api.post('/galaxy/api/season/shop/:id/buy', async (req): Promise<SeasonView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = seasonItemParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    const now = deps.now();
    const c = await seasonConfigs(deps.config);
    const score = await seasonScore(deps.db, c, s.accountId, now);
    return runOperation(deps.db, s.accountId, key, 'season.buy', requestHash({ id }), async (trx) => {
      await buyItem(trx, c, s.accountId, id, key, now);
      return seasonView(trx, c, s.accountId, score, now);
    });
  });
}
