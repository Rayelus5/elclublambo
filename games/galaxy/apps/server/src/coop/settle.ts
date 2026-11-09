import { type CoopOutcome, type RunClaim, type RunResult } from '@galaxy/shared';
import { runSummary, type Sim } from '@galaxy/sim';
import { type Kysely } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { missionConfigs } from '../missions/service';
import { creditRunExtras } from '../runs/extras';
import { settleRun } from '../runs/service';
import { invalidateLeaderboard } from '../social/leaderboard';
import type { CoopSlot, Gone } from './relay';

// Paying a co-op run (multiplayer plan, phase 6), from what the referee saw. Each player is paid on its own row, in
// its own operation (key `coop:<run>`), so paying twice (a restart, a retry) pays nothing more:
//   - the group's: depth, Cores and the shared loot of every layer × the loot factor for the players that layer
//     started with (coop.loot, by n);
//   - the player's own: its kills and level; and everything solo runs apply (daily yield, the Laboratorio's push,
//     global boosts, signals, material, components, caps);
//   - its season points × the factor for the players who launched (coop.points).
// A player who left is paid as abandoned with the loot up to when it went. An interrupted run (a restart) pays as an
// extraction of the loot so far.

export interface CoopSettlement {
  coopRunId: string;
  slots: CoopSlot[];
  referee: Sim;
  gone: (Gone | null)[];
  playersByLayer: number[];
  outcome: CoopOutcome;
}

export interface SettleDeps {
  db: Kysely<DB>;
  config: ConfigReader;
  now: () => Date;
}

const scaled = (loot: { coins: number; dust: number; components: number }[], factorOf: (layer: number) => number) =>
  loot.map((l, i) => {
    const f = factorOf(i);
    return { coins: Math.floor(l.coins * f), dust: Math.floor(l.dust * f), components: Math.floor(l.components * f) };
  });

/** Pays every player once; returns each one's result (null for a player whose pay failed, logged by the caller). */
export async function settleCoop(deps: SettleDeps, s: CoopSettlement): Promise<(RunResult | null)[]> {
  const [{ value: runs, version: runsVersion }, content, account, season, boosts, route, coop] = await Promise.all([
    deps.config.getVersioned('runs'),
    deps.config.get('content'),
    deps.config.get('account'),
    deps.config.get('season'),
    deps.config.get('boosts'),
    deps.config.get('seasonRoute'),
    deps.config.get('coop'),
  ]);
  const missions = await missionConfigs(deps.config);
  const now = deps.now();
  const sim = s.referee;
  const summary = runSummary(sim);
  const n = s.slots.length;
  const lootFactor = (layer: number) => {
    const players = s.playersByLayer[layer] ?? s.playersByLayer[s.playersByLayer.length - 1] ?? n;
    return coop.loot[Math.min(coop.loot.length, Math.max(1, players)) - 1] ?? 1;
  };
  const pointsFactor = coop.points[Math.min(coop.points.length, Math.max(1, n)) - 1] ?? 1;
  const results: (RunResult | null)[] = [];
  for (let slot = 0; slot < n; slot++) {
    const who = s.slots[slot]!;
    const gone = s.gone[slot];
    const probe = sim.probes[slot]!;
    const outcome: RunClaim['outcome'] = gone ? 'abandoned' : s.outcome === 'died' ? 'died' : 'extracted';
    const claim: RunClaim = {
      outcome,
      ticks: gone ? gone.tick : summary.ticks,
      depth: gone ? Math.max(1, gone.loot.length) : summary.depth,
      kills: gone ? gone.kills : probe.kills,
      bossKills: summary.bossKills,
      level: gone ? gone.level : probe.level,
      loot: scaled(gone ? gone.loot : summary.loot, lootFactor),
      hash: summary.hash,
    };
    const result = await runOperation(deps.db, who.accountId, `coop:${s.coopRunId}`, 'coop.finish', `coop:${s.coopRunId}:${slot}`, async (trx) => {
      const row = await trx.selectFrom('galaxy.runs').select(['id', 'upgrades', 'started_at', 'finished_at']).where('id', '=', who.runRowId).forUpdate().executeTakeFirstOrThrow();
      const wallSeconds = Math.max(0, (now.getTime() - new Date(row.started_at).getTime()) / 1000);
      const r = await settleRun(
        trx,
        who.accountId,
        { run: row, claim, claimed: claim, flags: [], penalized: false, wallSeconds, inputs: null, pointsFactor },
        `coop:${s.coopRunId}`,
        { runs, runsVersion, content, account, season, boosts, now },
      );
      await creditRunExtras(trx, who.accountId, row.id, r, `coop:${s.coopRunId}`, { season, perPoint: route.currency.perPoint, missions, now });
      return r;
    }).catch(() => null);
    results.push(result);
  }
  await deps.db
    .updateTable('galaxy.coop_runs')
    .set({ state: s.outcome === 'interrupted' ? 'interrupted' : 'ended', outcome: s.outcome, ticks: summary.ticks, depth: summary.depth, boss_kills: summary.bossKills, hash: summary.hash, ended_at: now })
    .where('id', '=', s.coopRunId)
    .where('state', '=', 'running')
    .execute();
  invalidateLeaderboard();
  return results;
}
