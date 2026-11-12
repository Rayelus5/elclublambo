import { autoFusionRequestSchema, fuseRequestSchema, galaxyLockSchema, relicLevelUpSchema, type AutoFusionPreview, type AutoFusionResult, type CollectionPage, type GalaxyDetail } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { countStats, missionConfigs } from '../missions/service';
import { autoFuse, disintegrate, fuse, galaxyDetail, levelUpGalaxy, listGalaxies, listQuerySchema, setLock, type CollectionDeps } from './service';
import { HttpError } from '../errors';
import { withNotices } from '../realtime/notices';

const idParam = z.object({ id: z.uuid() }).strict();

export function registerCollectionRoutes(api: FastifyInstance, deps: CollectionDeps): void {
  api.get('/galaxy/api/galaxies', async (req): Promise<CollectionPage> => {
    const s = requireSession(req);
    return listGalaxies(deps, s.accountId, listQuerySchema.parse(req.query));
  });

  api.get('/galaxy/api/galaxies/:id', async (req): Promise<GalaxyDetail> => {
    const s = requireSession(req);
    return galaxyDetail(deps, s.accountId, idParam.parse(req.params).id);
  });

  api.post('/galaxy/api/galaxies/:id/disintegrate', async (req) => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = idParam.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'galaxy_action', 120, 60);
    const [cfg, lab, relics, mcfg] = await Promise.all([deps.config.get('galaxies'), deps.config.get('lab'), deps.config.get('relics'), missionConfigs(deps.config)]);
    return withNotices(deps.live, (out) => runOperation(deps.db, s.accountId, key, 'galaxy.disintegrate', requestHash({ id }), async (trx) => {
      const r = await disintegrate({ cfg, lab, relics }, trx, s.accountId, id, key);
      await countStats(trx, mcfg, s.accountId, { disintegrations: 1 }, new Date(), out);
      return r;
    }));
  });

  api.post('/galaxy/api/galaxies/fuse', async (req) => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const body = fuseRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'galaxy_action', 120, 60);
    const [cfg, gacha, lab, relics, mcfg] = await Promise.all([deps.config.get('galaxies'), deps.config.get('gacha'), deps.config.get('lab'), deps.config.get('relics'), missionConfigs(deps.config)]);
    return withNotices(deps.live, (out) => runOperation(deps.db, s.accountId, key, 'galaxy.fuse', requestHash(body), async (trx) => {
      const r = await fuse({ cfg, gacha, lab, relics }, trx, s.accountId, body.ids, key);
      await countStats(trx, mcfg, s.accountId, { fusions: 1, legendaries: r.galaxy.tier === 'legendary' ? 1 : 0 }, new Date(), out);
      return r;
    }));
  });

  // The lock (plan phase 2): a locked galaxy is never fused nor disintegrated. Setting it twice is harmless.
  api.put('/galaxy/api/galaxies/:id/lock', async (req): Promise<GalaxyDetail> => {
    const s = requireSession(req);
    const { id } = idParam.parse(req.params);
    const { locked } = galaxyLockSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'galaxy_action', 120, 60);
    if (!(await setLock(deps.db, s.accountId, id, locked))) throw new HttpError(404, 'galaxy_not_found');
    return galaxyDetail(deps, s.accountId, id);
  });

  // The automatic fusion (plan phase 2): its preview (no key, nothing changes), or the fusions as one idempotent
  // operation. Each fusion counts for the missions like a manual one.
  api.post('/galaxy/api/galaxies/fuse-auto', async (req): Promise<AutoFusionPreview | AutoFusionResult> => {
    const s = requireSession(req);
    const body = autoFusionRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'galaxy_action', 120, 60);
    const [cfg, gacha, lab, relics, mcfg] = await Promise.all([deps.config.get('galaxies'), deps.config.get('gacha'), deps.config.get('lab'), deps.config.get('relics'), missionConfigs(deps.config)]);
    if (body.preview) return deps.db.transaction().execute((trx) => autoFuse({ cfg, gacha, lab, relics }, trx, s.accountId, body.criteria, true, ''));
    const key = idempotencyKey(req);
    return withNotices(deps.live, (out) => runOperation(deps.db, s.accountId, key, 'galaxy.fuse_auto', requestHash(body.criteria), async (trx) => {
      const r = (await autoFuse({ cfg, gacha, lab, relics }, trx, s.accountId, body.criteria, false, key)) as AutoFusionResult;
      if (r.fusions > 0) await countStats(trx, mcfg, s.accountId, { fusions: r.fusions, legendaries: r.galaxies.filter((g) => g.tier === 'legendary').length }, new Date(), out);
      return r;
    }));
  });

  // A galaxy's next level (M4c-1): the session first, then the body; an idempotent operation naming the level.
  api.post('/galaxy/api/galaxies/:id/level-up', async (req) => {
    const s = requireSession(req);
    const { id } = idParam.parse(req.params);
    const body = relicLevelUpSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'galaxy_action', 120, 60);
    const [galaxies, lab, relics] = await Promise.all([deps.config.get('galaxies'), deps.config.get('lab'), deps.config.get('relics')]);
    return runOperation(deps.db, s.accountId, key, 'galaxy.level', requestHash({ id, ...body }), (trx) =>
      levelUpGalaxy({ galaxies, lab, relics }, trx, s.accountId, id, body.level, key),
    );
  });
}
