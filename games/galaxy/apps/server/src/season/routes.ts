import { type HallOfFame, type SeasonHistory, seasonItemParamsSchema, seasonResultParamsSchema, seasonStepParamsSchema, type SeasonView, usernameParamSchema } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { accountNamed } from '../social/profiles';
import { claimResult, closeDue, hallOfFame, seasonHistory } from './close';
import { buyItem, claimStep, convertLeftovers, seasonConfigs, seasonScore, seasonView } from './service';

// The season's routes (GDD §13.1; M7d-1): the route and shop, collecting a step and buying an item (both idempotent).

export function registerSeasonRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader; now: () => Date }): void {
  api.get('/galaxy/api/season', async (req): Promise<SeasonView> => {
    const s = requireSession(req);
    const now = deps.now();
    const c = await seasonConfigs(deps.config);
    await closeDue(deps.db, c, now);
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

  // The rewards of a closed season (M7d-2), once.
  api.post('/galaxy/api/season/results/:season/claim', async (req): Promise<SeasonView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { season } = seasonResultParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    const now = deps.now();
    const c = await seasonConfigs(deps.config);
    const score = await seasonScore(deps.db, c, s.accountId, now);
    return runOperation(deps.db, s.accountId, key, 'season.close', requestHash({ season }), async (trx) => {
      await claimResult(trx, s.accountId, season, key, now);
      return seasonView(trx, c, s.accountId, score, now);
    });
  });

  // The hall of fame and a player's past seasons (M7d-2): public to every player, like profiles.
  api.get('/galaxy/api/hall-of-fame', async (req): Promise<HallOfFame> => {
    const s = requireSession(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'profiles', 120, 60);
    await closeDue(deps.db, await seasonConfigs(deps.config), deps.now());
    return hallOfFame(deps.db);
  });

  api.get('/galaxy/api/profiles/:username/seasons', async (req): Promise<SeasonHistory> => {
    const s = requireSession(req);
    const { username } = usernameParamSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'profiles', 120, 60);
    return seasonHistory(deps.db, (await accountNamed(deps.db, username)).id);
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
