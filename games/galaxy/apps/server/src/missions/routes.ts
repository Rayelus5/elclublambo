import { achievementClaimParamsSchema, missionClaimParamsSchema, type MissionsView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { claimAchievement, claimMission, missionConfigs, missionsView } from './service';

// Missions and achievements' routes (GDD §12.3; M7a): the screen's view, collecting (idempotent, like every economy
// action) and choosing the title and frame shown on the profile.

export function registerMissionRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader; now: () => Date }): void {
  api.get('/galaxy/api/missions', async (req): Promise<MissionsView> => {
    const s = requireSession(req);
    return missionsView(deps.db, await missionConfigs(deps.config), s.accountId, deps.now());
  });

  api.post('/galaxy/api/missions/:period/:id/claim', async (req): Promise<MissionsView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { period, id } = missionClaimParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    const now = deps.now();
    const c = await missionConfigs(deps.config);
    return runOperation(deps.db, s.accountId, key, 'missions.claim', requestHash({ period, id }), async (trx) => {
      await claimMission(trx, c, s.accountId, period, id, key, now);
      return missionsView(trx, c, s.accountId, now);
    });
  });

  api.post('/galaxy/api/achievements/:id/claim', async (req): Promise<MissionsView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = achievementClaimParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    const now = deps.now();
    const c = await missionConfigs(deps.config);
    return runOperation(deps.db, s.accountId, key, 'achievements.claim', requestHash({ id }), async (trx) => {
      await claimAchievement(trx, c, s.accountId, id, key, now);
      return missionsView(trx, c, s.accountId, now);
    });
  });

}
