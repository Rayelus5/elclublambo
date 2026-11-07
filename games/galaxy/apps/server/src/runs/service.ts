import { randomBytes, randomInt } from 'node:crypto';
import {
  checkRun,
  dailyFactor,
  dailySegments,
  runMaterial,
  runPayout,
  type FinishRunRequest,
  type RunResult,
  type RunsConfig,
  type RunStart,
  type SectorsConfig,
  sectorStatus,
  type StartRunRequest,
} from '@galaxy/shared';
import { type Content, decodeLog, fromBase64, logTicks } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { madridDay } from '../economy/day';
import { credit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { ensureHangar, relicSnapshot, sectorStats, testedProbe } from './hangar';

// Starting and finishing runs (GDD §5.1, §11.3 bis, §14.7). The server seeds the run and snapshots the equipped
// relics; the result comes back once, with the recorded inputs, and is checked, paid and kept. Both run inside an
// idempotent operation (routes.ts); the config they need is read before the transaction.

export interface StartContext {
  content: Content;
  sectors: SectorsConfig;
  contentVersion: number;
  now: Date;
}

export async function startRun(trx: Kysely<DB>, accountId: string, req: StartRunRequest, key: string, ctx: StartContext): Promise<RunStart> {
  const sector = ctx.content.sectors.find((s) => s.id === req.sector);
  if (!sector) throw new HttpError(400, 'invalid_input');
  const hangar = await ensureHangar(trx, accountId);
  // The probe test comes first (GDD §12.2): no run without the starting probe it gives.
  if ((await testedProbe(trx, accountId)) === null) throw new HttpError(409, 'probe_test_required');
  if (req.probe !== hangar.probe || !ctx.content.probes.some((p) => p.id === req.probe)) throw new HttpError(400, 'invalid_input');
  // Only an open sector (GDD §5.5, §13.1): its condition met, or the season now open.
  if (!sectorStatus(sector, await sectorStats(trx, accountId), ctx.sectors).unlocked) throw new HttpError(409, 'sector_locked');
  const relics = await relicSnapshot(trx, accountId, hangar.slots);
  const seed = randomBytes(8).readBigUInt64BE().toString();
  const row = await trx
    .insertInto('galaxy.runs')
    .values({
      account_id: accountId,
      seed,
      sector: req.sector,
      probe: req.probe,
      relics: JSON.stringify(relics),
      content_version: ctx.contentVersion,
      sim_version: req.simVersion,
      start_key: key,
      started_at: ctx.now,
    })
    .returning(['id', 'started_at'])
    .executeTakeFirstOrThrow();
  return {
    id: row.id,
    seed,
    sector: req.sector,
    probe: req.probe,
    relics,
    // Level 1 with the base weapon until the probe levels arrive (M4b-1 Task 4).
    bonuses: [],
    variant: null,
    content: ctx.content,
    contentVersion: ctx.contentVersion,
    startedAt: new Date(row.started_at).toISOString(),
  };
}

export interface FinishContext {
  runs: RunsConfig;
  runsVersion: number;
  content: Content;
  now: Date;
}

/** The most bytes of recorded inputs a run keeps (galaxy.run_inputs checks the same). */
export const MAX_INPUT_BYTES = 2_000_000;

/** The decoded log's last tick, or 400 bad_inputs. */
function inputsOf(b64: string, probes: number): { bytes: Uint8Array; lastTick: number } {
  try {
    const bytes = fromBase64(b64);
    if (bytes.length > MAX_INPUT_BYTES) throw new RangeError('bad_log');
    const log = decodeLog(bytes);
    if (log.probes !== probes) throw new RangeError('bad_log');
    return { bytes, lastTick: logTicks(log) };
  } catch {
    throw new HttpError(400, 'bad_inputs');
  }
}

export async function finishRun(trx: Kysely<DB>, accountId: string, runId: string, req: FinishRunRequest, key: string, ctx: FinishContext): Promise<RunResult> {
  const run = await trx
    .selectFrom('galaxy.runs')
    .select(['id', 'sector', 'started_at', 'finished_at'])
    .where('id', '=', runId)
    .where('account_id', '=', accountId)
    .forUpdate()
    .executeTakeFirst();
  if (!run) throw new HttpError(404, 'run_not_found');
  if (run.finished_at) throw new HttpError(409, 'run_finished');
  const startedAt = new Date(run.started_at).getTime();
  if ((ctx.now.getTime() - startedAt) / 1000 > ctx.runs.expireHours * 3600) throw new HttpError(410, 'run_expired');
  // Real time is counted once: a run that overlaps another finished one only has the time since that finish.
  const overlap = await trx
    .selectFrom('galaxy.runs')
    .select((eb) => eb.fn.max('finished_at').as('last'))
    .where('account_id', '=', accountId)
    .where('id', '<>', run.id)
    .where('finished_at', '>', new Date(startedAt))
    .executeTakeFirst();
  const from = overlap?.last ? Math.max(startedAt, new Date(overlap.last).getTime()) : startedAt;
  const wallSeconds = Math.max(0, (ctx.now.getTime() - from) / 1000);
  const { bytes, lastTick } = inputsOf(req.inputs, 1);

  const { inputs: _inputs, ...claimed } = req;
  const sector = ctx.content.sectors.find((s) => s.id === run.sector);
  const check = checkRun(claimed, { wallSeconds, layerSeconds: sector?.layerSeconds ?? 300, cfg: ctx.runs, logTicks: lastTick });
  const claim = check.claim;
  const seconds = Math.max(0, Math.floor(Math.min(claim.ticks / 60, wallSeconds)));

  // The day's run time, locked: two runs finishing at once cannot both claim the full rate.
  const day = madridDay(ctx.now);
  await trx.insertInto('galaxy.run_days').values({ account_id: accountId, day, seconds: 0 }).onConflict((oc) => oc.columns(['account_id', 'day']).doNothing()).execute();
  const today = await trx.selectFrom('galaxy.run_days').select('seconds').where('account_id', '=', accountId).where('day', '=', day).forUpdate().executeTakeFirstOrThrow();
  const segments = dailySegments(today.seconds, seconds, ctx.runs);
  const factor = dailyFactor(segments);
  await trx
    .updateTable('galaxy.run_days')
    .set({ seconds: sql`seconds + ${seconds}` })
    .where('account_id', '=', accountId)
    .where('day', '=', day)
    .execute();

  const pay = runPayout(claim, ctx.runs, factor, check.penalized);
  const flags = pay.capped ? [...check.flags, 'payout_cap' as const] : check.flags;
  let signals = 0;
  const chance = ctx.runs.signalChancePerBoss * factor;
  for (let k = 0; k < claim.bossKills; k++) if (randomInt(1_000_000) < chance * 1_000_000) signals++;
  const ref = { run: run.id };
  if (pay.coins > 0) await credit(trx, accountId, 'coins', pay.coins, 'run', ref, key);
  if (pay.dust > 0) await credit(trx, accountId, 'dust', pay.dust, 'run', ref, key);
  if (signals > 0) await credit(trx, accountId, 'signal', signals, 'run', ref, key);
  // Raw material for the station's refinery (GDD §10.3), paid like the loot.
  const material = runMaterial(claim, ctx.runs, factor, check.penalized);
  if (material > 0) await credit(trx, accountId, 'material', material, 'run', ref, key);

  const payout = { coins: pay.coins, dust: pay.dust, signals, material };
  await trx
    .updateTable('galaxy.runs')
    .set({
      finished_at: ctx.now,
      outcome: claim.outcome,
      ticks: claim.ticks,
      depth: claim.depth,
      kills: claim.kills,
      boss_kills: claim.bossKills,
      level: claim.level,
      seconds,
      hash: claim.hash,
      payout: JSON.stringify({ ...payout, layers: pay.layers, share: pay.share, daily: segments, claimed: claimed.loot }),
      runs_version: ctx.runsVersion,
      flags,
      suspicious: flags.length > 0,
    })
    .where('id', '=', run.id)
    .execute();
  await trx.insertInto('galaxy.run_inputs').values({ run_id: run.id, inputs: Buffer.from(bytes) }).execute();

  return {
    id: run.id,
    outcome: claim.outcome,
    ticks: claim.ticks,
    depth: claim.depth,
    kills: claim.kills,
    level: claim.level,
    payout,
    breakdown: { layers: pay.layers, share: pay.share, daily: segments },
    wallet: await getWallet(trx, accountId),
  };
}
