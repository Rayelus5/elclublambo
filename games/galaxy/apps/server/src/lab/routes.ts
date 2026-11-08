import { labUpgradeSchema, type LabView, type RedshiftView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import type { RunsDeps } from '../runs/hangar';
import { redshiftView, takeRedshift } from './redshift';
import { labView, upgradeLabNode } from './service';

// The Laboratorio's routes (GDD §10.6, M4b-2): its view, and buying a node's next level as an idempotent operation.
// The session is checked first, then the body.

const nodeParam = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();

export function registerLabRoutes(api: FastifyInstance, deps: RunsDeps): void {
  api.get('/galaxy/api/lab', async (req): Promise<LabView> => {
    const s = requireSession(req);
    return labView(deps, s.accountId);
  });

  api.post('/galaxy/api/lab/nodes/:id/upgrade', async (req): Promise<LabView> => {
    const s = requireSession(req);
    const { id } = nodeParam.parse(req.params);
    const body = labUpgradeSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'lab', 60, 60);
    return runOperation(deps.db, s.accountId, key, 'lab.upgrade', requestHash({ id, ...body }), (trx) => upgradeLabNode(deps, trx, s.accountId, id, body.level, key));
  });

  // The prestige «Corrimiento al rojo» (GDD §12.5; M7e-2): where you are, and taking the next rank (idempotent).
  api.get('/galaxy/api/redshift', async (req): Promise<RedshiftView> => {
    const s = requireSession(req);
    const [cfg, account] = await Promise.all([deps.config.get('redshift'), deps.config.get('account')]);
    return redshiftView(deps.db, cfg, account, s.accountId);
  });

  api.post('/galaxy/api/redshift', async (req): Promise<RedshiftView> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'lab', 60, 60);
    const [cfg, account] = await Promise.all([deps.config.get('redshift'), deps.config.get('account')]);
    // The station's config is read now, not inside the transaction (settling the refinery needs it).
    await deps.config.get('station');
    return runOperation(deps.db, s.accountId, key, 'redshift.take', requestHash({}), (trx) => takeRedshift(deps, trx, cfg, account, s.accountId));
  });
}
