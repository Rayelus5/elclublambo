import {
  activeBoosts,
  type BoostsView,
  finishRunRequestSchema,
  loadoutRequestSchema,
  probeChoiceSchema,
  probeLevelUpSchema,
  probeVariantSchema,
  slotUnlockSchema,
  probeTestRequestSchema,
  sectorChoiceSchema,
  startRunRequestSchema,
  type HangarView,
  type ProbeTestResult,
  type RunResult,
  type RunStart,
  activeAnomaly,
  seasonCurrency,
  shardsFor,
} from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { operationExists, runOperation } from '../economy/operations';
import { credit } from '../economy/wallet';
import { HttpError } from '../errors';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { hangarView, type RunsDeps, setLoadout, unlockSlot } from './hangar';
import { chooseVariant, levelUpProbe } from './levels';
import { chooseProbe, takeProbeTest } from './probes';
import { chooseSector } from './sectors';
import { finishRun, startRun } from './service';
import { countStats, missionConfigs } from '../missions/service';
import { invalidateLeaderboard } from '../social/leaderboard';

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

  // The next relic slot (M4c-1): an idempotent operation naming the slot it opens.
  api.post('/galaxy/api/hangar/slots/unlock', async (req): Promise<HangarView> => {
    const s = requireSession(req);
    const body = slotUnlockSchema.parse(req.body);
    const key = idempotencyKey(req);
    await hitRateLimit(deps.db, `a:${s.accountId}`, 'hangar_slot', 30, 60);
    return runOperation(deps.db, s.accountId, key, 'hangar.slot', requestHash(body), (trx) => unlockSlot(deps, trx, s.accountId, body.slot, key));
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
    const planetarium = await deps.config.get('planetarium');
    const now = deps.now();
    const anomaly = activeAnomaly(await deps.config.get('season'), content, now)?.id ?? null;
    return runOperation(deps.db, s.accountId, key, 'runs.start', requestHash(body), (trx) =>
      startRun(trx, s.accountId, body, key, { content, contentVersion, now, sectors, probes, lab, planetarium, anomaly }),
    );
  });

  // The global multipliers running now (GDD §16.3; M6d-5), for the hub and the hangar.
  api.get('/galaxy/api/boosts', async (req): Promise<BoostsView> => {
    requireSession(req);
    const [cfg, season, content] = await Promise.all([deps.config.get('boosts'), deps.config.get('season'), deps.config.get('content')]);
    const now = deps.now();
    const a = activeAnomaly(season, content, now);
    return {
      boosts: activeBoosts(cfg, now).map((b) => ({ id: b.id, name: b.name, currency: b.currency, factor: b.factor, endsAt: b.endsAt })),
      anomaly: a ? { id: a.id, name: a.name, description: a.description } : null,
    };
  });

  api.post('/galaxy/api/runs/:id/finish', { bodyLimit: FINISH_BODY_LIMIT }, async (req): Promise<RunResult> => {
    const s = requireSession(req);
    const key = idempotencyKey(req);
    const { id } = idParam.parse(req.params);
    const body = finishRunRequestSchema.parse(req.body);
    // A resend of a stored result (same key) answers from the operation without using up the limit.
    if (!(await operationExists(deps.db, s.accountId, key))) await hitRateLimit(deps.db, `a:${s.accountId}`, 'run_finish', 60, 3600);
    const [{ value: runs, version: runsVersion }, content, account, season, boosts, route] = await Promise.all([
      deps.config.getVersioned('runs'),
      deps.config.get('content'),
      deps.config.get('account'),
      deps.config.get('season'),
      deps.config.get('boosts'),
      deps.config.get('seasonRoute'),
    ]);
    const now = deps.now();
    const mcfg = await missionConfigs(deps.config);
    const result = await runOperation(deps.db, s.accountId, key, 'runs.finish', requestHash({ id, body }), async (trx) => {
      const r = await finishRun(trx, s.accountId, id, body, key, { runs, runsVersion, content, account, season, boosts, now });
      // The season currency (M7d-1): a share of the points a run that counts adds.
      const shards = shardsFor(r.progress.points, route.currency.perPoint);
      if (shards > 0) {
        await credit(trx, s.accountId, seasonCurrency(season.id), shards, 'season_run', { run: id }, key);
        r.progress.shards = shards;
      }
      // Missions and achievements (M7a): what a run that is not suspicious did, as kept.
      const kept = await trx.selectFrom('galaxy.runs').select(['suspicious', 'seconds', 'kills', 'boss_kills', 'depth', 'outcome']).where('id', '=', id).executeTakeFirstOrThrow();
      if (!kept.suspicious) {
        await countStats(trx, mcfg, s.accountId, { runs: 1, minutes: Math.floor((kept.seconds ?? 0) / 60), kills: kept.kills ?? 0, bossKills: kept.boss_kills ?? 0, extractions: kept.outcome === 'extracted' ? 1 : 0, depth: kept.depth ?? 0 }, now);
      }
      return r;
    });
    // The season moved (M5a): the next leaderboard read counts this run, not the cached one from before it.
    invalidateLeaderboard();
    return result;
  });
}
