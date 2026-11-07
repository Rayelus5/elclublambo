import {
  finishRunRequestSchema,
  loadoutRequestSchema,
  probeChoiceSchema,
  probeLevelUpSchema,
  probeVariantSchema,
  probeTestRequestSchema,
  sectorChoiceSchema,
  startRunRequestSchema,
  type HangarView,
  type ProbeTestResult,
  type RunResult,
  type RunStart,
} from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { operationExists, runOperation } from '../economy/operations';
import { HttpError } from '../errors';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { hangarView, type RunsDeps, setLoadout } from './hangar';
import { chooseVariant, levelUpProbe } from './levels';
import { chooseProbe, takeProbeTest } from './probes';
import { chooseSector } from './sectors';
import { finishRun, startRun } from './service';

const idParam = z.object({ id: z.uuid() }).strict();
/** A finished run carries its recorded inputs (≤ 2 MB of bytes, ~2.7 MB in base64). */
const FINISH_BODY_LIMIT = 3 * 1024 * 1024;

async function requireRuns(deps: RunsDeps): Promise<void> {
  if (!(await deps.config.get('features')).runs) throw new HttpError(503, 'runs_disabled');
}

const probeParam = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();

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

  api.post('/galaxy/api/probe-test', async (req): Promise<ProbeTestResult> => {
    const s = requireSession(req);
    const body = probeTestRequestSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'probe_test', 20, 3600);
    return takeProbeTest(deps, s.accountId, body);
  });

  api.put('/galaxy/api/hangar/sector', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    const body = sectorChoiceSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'hangar_sector', 60, 60);
    return chooseSector(deps, s.accountId, body);
  });

  api.put('/galaxy/api/hangar/probe', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    const body = probeChoiceSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'hangar_probe', 60, 60);
    return chooseProbe(deps, s.accountId, body);
  });

  // Probe levels and starting weapons (M4b-1): the session first, then the body; buying a level is an idempotent
  // operation, choosing the weapon a plain update.
  api.post('/galaxy/api/hangar/probes/:id/level-up', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    const { id } = probeParam.parse(req.params);
    const body = probeLevelUpSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'hangar_level', 60, 60);
    return runOperation(deps.db, s.accountId, key, 'hangar.level', requestHash({ id, ...body }), (trx) => levelUpProbe(deps, trx, s.accountId, id, body.level, key));
  });

  api.put('/galaxy/api/hangar/probes/:id/variant', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    const { id } = probeParam.parse(req.params);
    const body = probeVariantSchema.parse(req.body);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'hangar_variant', 60, 60);
    return chooseVariant(deps, s.accountId, id, body.variant);
  });

  api.post('/galaxy/api/runs', async (req): Promise<RunStart> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const body = startRunRequestSchema.parse(req.body);
    await requireRuns(deps);
    const runs = await deps.config.get('runs');
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'run_start', runs.startPerHour, 3600);
    const { value: content, version: contentVersion } = await deps.config.getVersioned('content');
    const sectors = await deps.config.get('sectors');
    const probes = await deps.config.get('probes');
    const lab = await deps.config.get('lab');
    const now = deps.now();
    return runOperation(deps.db, s.accountId, key, 'runs.start', requestHash(body), (trx) =>
      startRun(trx, s.accountId, body, key, { content, contentVersion, now, sectors, probes, lab }),
    );
  });

  api.post('/galaxy/api/runs/:id/finish', { bodyLimit: FINISH_BODY_LIMIT }, async (req): Promise<RunResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = idParam.parse(req.params);
    const body = finishRunRequestSchema.parse(req.body);
    // A resend of a stored result (same key) answers from the operation without using up the limit.
    if (!(await operationExists(deps.db, s.accountId, key))) await hitRateLimit(deps.db, `a:${s.accountId}`, 'run_finish', 60, 3600);
    const [{ value: runs, version: runsVersion }, content] = await Promise.all([deps.config.getVersioned('runs'), deps.config.get('content')]);
    const now = deps.now();
    return runOperation(deps.db, s.accountId, key, 'runs.finish', requestHash({ id, body }), (trx) =>
      finishRun(trx, s.accountId, id, body, key, { runs, runsVersion, content, now }),
    );
  });
}
