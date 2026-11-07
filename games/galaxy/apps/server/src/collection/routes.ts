import { fuseRequestSchema, type CollectionPage, type GalaxyDetail } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { disintegrate, fuse, galaxyDetail, listGalaxies, listQuerySchema, type CollectionDeps } from './service';

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
    const [cfg, lab] = await Promise.all([deps.config.get('galaxies'), deps.config.get('lab')]);
    return runOperation(deps.db, s.accountId, key, 'galaxy.disintegrate', requestHash({ id }), (trx) =>
      disintegrate({ cfg, lab }, trx, s.accountId, id, key),
    );
  });

  api.post('/galaxy/api/galaxies/fuse', async (req) => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const body = fuseRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'galaxy_action', 120, 60);
    const [cfg, gacha, lab] = await Promise.all([deps.config.get('galaxies'), deps.config.get('gacha'), deps.config.get('lab')]);
    return runOperation(deps.db, s.accountId, key, 'galaxy.fuse', requestHash(body), (trx) => fuse({ cfg, gacha, lab }, trx, s.accountId, body.ids, key));
  });
}
