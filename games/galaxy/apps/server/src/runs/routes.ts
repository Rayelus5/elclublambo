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
  type LiveContentView,
  type ProbeTestResult,
  type RunResult,
  type RunStart,
  activeAnomaly,
} from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../auth/guards';
import { operationExists, runOperation } from '../economy/operations';
import { HttpError } from '../errors';
import { withNotices } from '../realtime/notices';
import { idempotencyKey, requestHash } from '../gacha/routes';
import { hitRateLimit } from '../ratelimit';
import { hangarView, type RunsDeps, setLoadout, unlockSlot } from './hangar';
import { chooseVariant, levelUpProbe } from './levels';
import { chooseProbe, takeProbeTest } from './probes';
import { chooseSector } from './sectors';
import { finishRun, startRun } from './service';
import { missionConfigs } from '../missions/service';
import { creditRunExtras } from './extras';
import { labSeasonId } from '../lab/levels';
import { invalidateLeaderboard } from '../social/leaderboard';

const idParam = z.object({ id: z.uuid() }).strict();
/** A finished run carries its recorded inputs (≤ 2 MB of bytes, ~2.7 MB in base64). */
const FINISH_BODY_LIMIT = 3 * 1024 * 1024;

async function requireRuns(deps: RunsDeps): Promise<void> {
  if (!(await deps.config.get('features')).runs) throw new HttpError(503, 'runs_disabled');
}

const probeParam = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();

/** `onProbeChosen`: the probe was changed in the hangar (the rooms show it to the player's group). */
export function registerRunRoutes(api: FastifyInstance, deps: RunsDeps & { onProbeChosen?: (accountId: string, probe: string) => Promise<void> }): void {
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
    const view = await chooseProbe(deps, s.accountId, body);
    // The choice is made; telling the room is a courtesy that never fails it.
    await deps.onProbeChosen?.(s.accountId, view.probe).catch((err: unknown) => req.log.warn({ err }, 'room probe refresh failed'));
    return view;
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

  // The live content, for what the web tells about relics and sets (plan «escáner pro», part D): the version as an
  // ETag, so an unchanged one is a 304.
  api.get('/galaxy/api/content', async (req, reply) => {
    requireSession(req);
    const { value, version } = await deps.config.getVersioned('content');
    const etag = `"content-${version}"`;
    reply.header('etag', etag).header('cache-control', 'private, max-age=60');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    const view: LiveContentView = { version, content: value };
    return view;
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
    const season = await deps.config.get('season');
    const anomaly = activeAnomaly(season, content, now)?.id ?? null;
    const labSeason = labSeasonId(lab, season, now);
    const redshift = await deps.config.get('redshift');
    return runOperation(deps.db, s.accountId, key, 'runs.start', requestHash(body), (trx) =>
      startRun(trx, s.accountId, body, key, { content, contentVersion, now, sectors, probes, lab, planetarium, anomaly, redshift, labSeason }),
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
    const result = await withNotices(deps.live, (out) =>
      runOperation(deps.db, s.accountId, key, 'runs.finish', requestHash({ id, body }), async (trx) => {
        const r = await finishRun(trx, s.accountId, id, body, key, { runs, runsVersion, content, account, season, boosts, now });
        // The season currency for its points, and the missions for what it did (runs/extras.ts).
        await creditRunExtras(trx, s.accountId, id, r, key, { season, perPoint: route.currency.perPoint, missions: mcfg, now }, {}, out);
        return r;
      }),
    );
    // The season moved (M5a): the next leaderboard read counts this run, not the cached one from before it.
    invalidateLeaderboard();
    return result;
  });
}
