import { finishRunRequestSchema, loadoutRequestSchema, startRunRequestSchema, type HangarView, type RunResult, type RunStart } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { runOperation } from '../economy/operations';
import { HttpError } from '../errors';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { hangarView, type RunsDeps, setLoadout } from './hangar';
import { finishRun, startRun } from './service';

const idParam = z.object({ id: z.uuid() }).strict();
/** A finished run carries its recorded inputs (≤ 2 MB of bytes, ~2.7 MB in base64). */
const FINISH_BODY_LIMIT = 3 * 1024 * 1024;

async function requireRuns(deps: RunsDeps): Promise<void> {
  if (!(await deps.config.get('features')).runs) throw new HttpError(503, 'runs_disabled');
}

export function registerRunRoutes(api: FastifyInstance, deps: RunsDeps): void {
  api.get('/galaxy/api/hangar', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    return hangarView(deps, s.accountId);
  });

  api.put('/galaxy/api/hangar/loadout', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    const body = loadoutRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'hangar_loadout', 60, 60);
    return setLoadout(deps, s.accountId, body);
  });

  api.post('/galaxy/api/runs', async (req): Promise<RunStart> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const body = startRunRequestSchema.parse(req.body);
    await requireRuns(deps);
    const runs = await deps.config.get('runs');
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'run_start', runs.startPerHour, 3600);
    const { value: content, version: contentVersion } = await deps.config.getVersioned('content');
    const now = deps.now();
    return runOperation(deps.db, s.accountId, key, 'runs.start', requestHash(body), (trx) =>
      startRun(trx, s.accountId, body, key, { content, contentVersion, now }),
    );
  });

  api.post('/galaxy/api/runs/:id/finish', { bodyLimit: FINISH_BODY_LIMIT }, async (req): Promise<RunResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = idParam.parse(req.params);
    const body = finishRunRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'run_finish', 60, 3600);
    const [{ value: runs, version: runsVersion }, content] = await Promise.all([deps.config.getVersioned('runs'), deps.config.get('content')]);
    const now = deps.now();
    return runOperation(deps.db, s.accountId, key, 'runs.finish', requestHash({ id, body }), (trx) =>
      finishRun(trx, s.accountId, id, body, key, { runs, runsVersion, content, now }),
    );
  });
}
