import { runSummary, type Sim, type SimOptions } from '@galaxy/sim';
import type { AdminRunReplay } from '../api/admin-runs';
import { coopSimOptions } from '../api/coop';

// Replaying a kept run and checking its end (GDD §14.7, §16.6; M6d-3): the panel's replayer and, since the tournaments
// (plan «temporadas como fichas», part 5), the server's review of the prize places' runs use the same rules, so what an
// admin sees in «Comprobar» is what the server decided.

/**
 * A replay's start as simulation options: its seed, content and sector, and the probe with its snapshot; a group run
 * (phase 6c) is the group's, with every player's probe and the group's rules.
 */
export function replayOptionsOf(start: AdminRunReplay['start'], coop: AdminRunReplay['coop'] = null): SimOptions {
  if (coop) return coopSimOptions({ seed: start.seed, content: start.content, sector: start.sector, anomaly: start.anomaly, rules: coop.rules, players: coop.players });
  return {
    seed: start.seed,
    content: start.content,
    sector: start.sector,
    probes: [{ probe: start.probe, relics: start.relics, bonuses: start.bonuses, variant: start.variant }],
    anomaly: start.anomaly ?? null,
    record: false,
  };
}

/** The tick a replay plays to: the one the client sent (the kept one may be clipped to real time), else the kept one. */
export function replayUntil(run: AdminRunReplay['run'], coop: AdminRunReplay['coop'] = null): number {
  // A group run plays to the group's end, whenever this player left it.
  if (coop) return coop.ticks ?? 0;
  return run.claimed?.ticks ?? run.ticks ?? 0;
}

/** Flags that mean the server clipped what it kept (ticks, depth, kills or boss kills) below what the client sent. */
export const CLIPPING_FLAGS = ['too_fast', 'depth_vs_time', 'kills_rate', 'boss_kills'] as const;

export type CheckKey = 'hash' | 'ticks' | 'kills' | 'depth' | 'level' | 'bossKills' | 'outcome';
export interface CheckRow {
  key: CheckKey;
  saved: string | number | null;
  replayed: string | number;
  same: boolean;
}

/** The replay's end in the run's own words: a run still going at its last tick is one the player abandoned there. */
function outcomeOf(sim: Sim): 'extracted' | 'died' | 'abandoned' {
  const o = runSummary(sim).outcome;
  return o === 'extracted' ? 'extracted' : o === 'dead' ? 'died' : 'abandoned';
}

/**
 * The replay's end against what the client sent at the finish (the hash always was kept as sent; the other figures as
 * sent since M6d-3, clipped before): every figure must match, a right hash with an inflated count is not the same run.
 * A solo run also compares its Cores and its outcome (the tournaments, 2026-11-22).
 */
export function checkReplay(sim: Sim, run: AdminRunReplay['run'], coop: AdminRunReplay['coop'] = null): { matches: boolean; rows: CheckRow[] } {
  const s = runSummary(sim);
  const sent = run.claimed ?? run;
  if (coop) {
    // A group run: the group's end (hash, ticks, depth); the player's own kills and level when they stayed to the end
    // (who left was paid what they had when they went, which the end of the run no longer shows).
    const me = sim.probes[coop.slot];
    const stayed = sent.ticks === coop.ticks;
    const rows: CheckRow[] = (
      [
        ['hash', coop.hash, s.hash],
        ['ticks', coop.ticks, s.ticks],
        ['depth', coop.depth, s.depth],
        ...(stayed ? ([['kills', sent.kills, me?.kills ?? 0], ['level', sent.level, me?.level ?? 1]] as const) : []),
      ] as const
    ).map(([key, saved, replayed]) => ({ key, saved, replayed, same: saved === replayed }));
    return { matches: rows.every((r) => r.same), rows };
  }
  const rows: CheckRow[] = (
    [
      ['hash', run.hash, s.hash],
      ['ticks', sent.ticks, s.ticks],
      ['kills', sent.kills, s.kills],
      ['depth', sent.depth, s.depth],
      ['level', sent.level, s.level],
      ['bossKills', sent.bossKills, s.bossKills],
      ['outcome', run.outcome, outcomeOf(sim)],
    ] as const
  ).map(([key, saved, replayed]) => ({ key, saved, replayed, same: saved === replayed }));
  return { matches: rows.every((r) => r.same), rows };
}
