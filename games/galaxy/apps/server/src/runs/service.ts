import { randomBytes, randomInt } from 'node:crypto';
import {
  checkRun,
  dailyFactor,
  dailySegments,
  runComponents,
  runMaterial,
  runPayout,
  type FinishRunRequest,
  type AccountConfig,
  type LabConfig,
  type PlanetariumConfig,
  probeLevelBonuses,
  probeMaxLevel,
  type ProbesConfig,
  type RunResult,
  type RunsConfig,
  type RunStart,
  type SeasonConfig,
  type SectorsConfig,
  sectorStatus,
  type StartRunRequest,
  startingWeapon,
  activeBoosts,
  boostFactor,
  type RedshiftConfig,
  redshiftBonuses,
  type BoostCurrency,
  type BoostsConfig,
  type RunClaim,
  type RunFlag,
} from '@galaxy/shared';
import { type Content, decodeLog, fromBase64, logTicks } from '@galaxy/sim';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { madridDay } from '../economy/day';
import { credit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { ensureHangar, relicSnapshot, sectorStats, testedProbe } from './hangar';
import { probeLevels } from './levels';
import { accountLabEffects } from '../lab/levels';
import { redshiftRank } from '../lab/redshift';
import { planetariumXp } from '../planetarium/service';
import { creditRunProgress } from '../social/progress';

// Starting and finishing runs (GDD §5.1, §11.3 bis, §14.7). The server seeds the run and snapshots the equipped
// relics; the result comes back once, with the recorded inputs, and is checked, paid and kept. Both run inside an
// idempotent operation (routes.ts); the config they need is read before the transaction.

export interface StartContext {
  content: Content;
  sectors: SectorsConfig;
  probes: ProbesConfig;
  lab: LabConfig;
  planetarium: PlanetariumConfig;
  contentVersion: number;
  /** The season's anomaly now (M7d-3), already checked against the content; null, none. */
  anomaly: string | null;
  /** The prestige's config (M7e-2): each rank adds its bonus to the run. */
  redshift: RedshiftConfig;
  /** The season whose Laboratorio core counts now (`labSeasonId`), or null. */
  labSeason: string | null;
  now: Date;
}

/** A run's seed: 64 random bits, in decimal. */
export function newRunSeed(): string {
  return randomBytes(8).readBigUInt64BE().toString();
}

export type LoadoutContext = Pick<StartContext, 'content' | 'probes' | 'lab' | 'planetarium' | 'redshift' | 'labSeason'>;

/**
 * What a run snapshots of a player at its start (solo and co-op): the equipped relics, the probe's level bonuses and
 * starting weapon (GDD §6, M4b-1: a variant its level no longer opens starts as the base), the Laboratorio's stat
 * bonuses and its push on the pay (M4b-2; both cores since the shop and lab plan, F2a: a season that ends during the
 * run changes nothing), the planetarium's experience (M4c-2) and the prestige's bonus (M7e-2).
 */
export async function loadoutSnapshot(trx: Kysely<DB>, accountId: string, probe: string, slots: number, ctx: LoadoutContext) {
  const relics = await relicSnapshot(trx, accountId, slots);
  const probeDef = ctx.content.probes.find((p) => p.id === probe)!;
  const saved = (await probeLevels(trx, accountId))[probe];
  const level = Math.min(saved?.level ?? 1, probeMaxLevel(ctx.probes));
  const lab = await accountLabEffects(trx, accountId, ctx.lab, ctx.labSeason);
  const xp = await planetariumXp(trx, accountId, ctx.planetarium);
  const prestige = redshiftBonuses(await redshiftRank(trx, accountId), ctx.redshift);
  const bonuses = [...probeLevelBonuses(level, ctx.probes), ...lab.bonuses, ...(xp > 0 ? [{ stat: 'xp' as const, value: xp }] : []), ...prestige];
  const weapon = startingWeapon(probeDef, level, saved?.variant ?? null, ctx.content);
  return { relics, bonuses, variant: weapon === probeDef.weapon ? null : weapon, payout: lab.payout };
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
  const { relics, bonuses, variant, payout } = await loadoutSnapshot(trx, accountId, req.probe, hangar.slots, ctx);
  const seed = newRunSeed();
  const row = await trx
    .insertInto('galaxy.runs')
    .values({
      account_id: accountId,
      seed,
      sector: req.sector,
      probe: req.probe,
      relics: JSON.stringify(relics),
      upgrades: JSON.stringify({ bonuses, variant, payout, anomaly: ctx.anomaly }),
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
    bonuses,
    variant,
    anomaly: ctx.anomaly,
    content: ctx.content,
    contentVersion: ctx.contentVersion,
    startedAt: new Date(row.started_at).toISOString(),
  };
}

/** The Laboratorio's push on a run's pay, as snapshotted at its start (none for runs started before M4b-2). */
function payoutBoost(upgrades: unknown): { coins: number; dust: number; material: number } {
  const p = (upgrades as { payout?: Partial<Record<'coins' | 'dust' | 'material', unknown>> } | null)?.payout ?? {};
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 1) : 0);
  return { coins: n(p.coins), dust: n(p.dust), material: n(p.material) };
}

export interface FinishContext {
  runs: RunsConfig;
  runsVersion: number;
  content: Content;
  /** The account level and the season (M5a): experience and points for a run that is not suspicious. */
  account: AccountConfig;
  season: SeasonConfig;
  /** The temporary global multipliers (M6d-5): those running at the finish pay this run. */
  boosts: BoostsConfig;
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
    .select(['id', 'sector', 'started_at', 'finished_at', 'upgrades'])
    .where('id', '=', runId)
    .where('account_id', '=', accountId)
    // A co-op player's row is paid by its run (coop/settle.ts), never through the solo finish.
    .where('coop_run_id', 'is', null)
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
  return settleRun(trx, accountId, { run, claim: check.claim, claimed, flags: check.flags, penalized: check.penalized, wallSeconds, inputs: bytes, pointsFactor: 1 }, key, ctx);
}

/** What a run is paid on: its row, the figures kept (and those sent), the checks' verdict and its real time. */
export interface SettleInput {
  run: { id: string; upgrades: unknown };
  claim: RunClaim;
  /** What the client sent (solo) or the referee saw (co-op), before any clipping. */
  claimed: RunClaim;
  flags: RunFlag[];
  penalized: boolean;
  wallSeconds: number;
  /** The run's recorded inputs (solo); a co-op run keeps its log in coop_run_inputs. */
  inputs: Uint8Array | null;
  /** The factor on its season points (co-op: by the number of players, multiplayer plan). */
  pointsFactor: number;
}

/**
 * Pays a finished run and keeps it (solo and co-op): the day's run time and its yield, the loot by layer, signals,
 * material and components, the row's figures, the inputs and the account's progress.
 */
export async function settleRun(trx: Kysely<DB>, accountId: string, s: SettleInput, key: string, ctx: FinishContext): Promise<RunResult> {
  const { run, claim, claimed, wallSeconds } = s;
  const check = { flags: s.flags, penalized: s.penalized };
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

  const boost = payoutBoost(run.upgrades);
  // The global multipliers running now (M6d-5), before the per-run caps; the signal chance never above 1.
  const boosted = activeBoosts(ctx.boosts, ctx.now).map((b) => ({ id: b.id, name: b.name, currency: b.currency, factor: b.factor }));
  const global = (c: BoostCurrency) => boostFactor(ctx.boosts, c, ctx.now);
  const pay = runPayout(claim, ctx.runs, factor, check.penalized, boost, { coins: global('coins'), dust: global('dust') });
  const flags = pay.capped ? [...check.flags, 'payout_cap' as const] : check.flags;
  let signals = 0;
  const chance = Math.min(1, ctx.runs.signalChancePerBoss * factor * global('signal'));
  for (let k = 0; k < claim.bossKills; k++) if (randomInt(1_000_000) < chance * 1_000_000) signals++;
  const ref = { run: run.id };
  if (pay.coins > 0) await credit(trx, accountId, 'coins', pay.coins, 'run', ref, key);
  if (pay.dust > 0) await credit(trx, accountId, 'dust', pay.dust, 'run', ref, key);
  if (signals > 0) await credit(trx, accountId, 'signal', signals, 'run', ref, key);
  // Raw material for the station's refinery (GDD §10.3), paid like the loot.
  const material = runMaterial(claim, ctx.runs, factor, check.penalized, boost.material, global('material'));
  if (material > 0) await credit(trx, accountId, 'material', material, 'run', ref, key);
  // Components from the breakable props (SIM 1.7.0), paid like the material.
  const components = runComponents(claim, ctx.runs, factor, check.penalized, global('material'));
  if (components > 0) await credit(trx, accountId, 'components', components, 'run', ref, key);

  const payout = { coins: pay.coins, dust: pay.dust, signals, material, components };
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
      payout: JSON.stringify({ ...payout, layers: pay.layers, share: pay.share, daily: segments, claimed: claimed.loot, boosts: boosted }),
      runs_version: ctx.runsVersion,
      flags,
      suspicious: flags.length > 0,
      // What the client sent, next to what was kept: the replayer plays to these ticks and compares against them.
      claim: JSON.stringify({ ticks: claimed.ticks, depth: claimed.depth, kills: claimed.kills, bossKills: claimed.bossKills, level: claimed.level }),
    })
    .where('id', '=', run.id)
    .execute();
  if (s.inputs) await trx.insertInto('galaxy.run_inputs').values({ run_id: run.id, inputs: Buffer.from(s.inputs) }).execute();
  const progress = await creditRunProgress(
    trx,
    accountId,
    { seconds, depth: claim.depth, bossKills: claim.bossKills, outcome: claim.outcome, suspicious: flags.length > 0 },
    { account: ctx.account, season: ctx.season },
    ctx.now,
    s.pointsFactor,
  );

  return {
    id: run.id,
    outcome: claim.outcome,
    ticks: claim.ticks,
    depth: claim.depth,
    kills: claim.kills,
    level: claim.level,
    payout,
    breakdown: { layers: pay.layers, share: pay.share, daily: segments, boosts: boosted },
    wallet: await getWallet(trx, accountId),
    progress,
  };
}
