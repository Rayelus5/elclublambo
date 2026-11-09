import { catalogClaimParamsSchema, type CatalogSummary, type CatalogView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import { requireSession } from '../auth/guards';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { catalogView, claimCatalog } from './service';

// The ECN Catalogue's routes (GDD §12.3; M7b): the album and collecting a share's reward (idempotent).

export function registerCatalogRoutes(api: FastifyInstance, deps: { db: Kysely<DB>; config: ConfigReader }): void {
  api.get('/galaxy/api/catalog', async (req): Promise<CatalogView> => {
    const s = requireSession(req);
    return catalogView(deps.db, await deps.config.get('catalog'), s.accountId);
  });

  // The button's light (hub, collection): how many shares wait to be collected.
  api.get('/galaxy/api/catalog/summary', async (req): Promise<CatalogSummary> => {
    const s = requireSession(req);
    const v = await catalogView(deps.db, await deps.config.get('catalog'), s.accountId);
    return { ready: v.rewards.filter((r) => r.reached && !r.claimed).length, percent: v.percent };
  });

  api.post('/galaxy/api/catalog/:percent/claim', async (req): Promise<CatalogView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { percent } = catalogClaimParamsSchema.parse(req.params);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'claims', 60, 60);
    const cfg = await deps.config.get('catalog');
    return runOperation(deps.db, s.accountId, key, 'catalog.claim', requestHash({ percent }), async (trx) => {
      await claimCatalog(trx, cfg, s.accountId, percent, key);
      return catalogView(trx, cfg, s.accountId);
    });
  });
}
