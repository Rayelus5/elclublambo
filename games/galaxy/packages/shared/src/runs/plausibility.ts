import type { RunClaim } from '../api/runs';
import type { RunsConfig } from './rewards';

// Plausibility of a finished run (GDD §14.7). The run is simulated by the client, so the server checks that the claim
// could have happened: time against the wall clock, depth against time, kill rate, boss kills against the layers,
// the input log against the claimed end, and loot against what the kills could drop. A failed check flags the run
// (it does not score) and clips its loot; replaying the inputs comes later (M5).

export type RunFlag = 'too_fast' | 'depth_vs_time' | 'kills_rate' | 'boss_kills' | 'log_mismatch' | 'loot_cap';

export interface RunCheckContext {
  /** Seconds between the run's start on the server and its finish. */
  wallSeconds: number;
  /** The sector's layer length (content), in seconds. */
  layerSeconds: number;
  cfg: RunsConfig;
  /** Last tick of the decoded input log (null when not decoded). */
  logTicks: number | null;
}

/** Scales every layer down so the total fits `cap` (never up). */
function clip(values: number[], cap: number): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= cap) return values;
  const room = Math.max(0, cap);
  return values.map((v) => Math.floor((v * room) / total));
}

export function checkRun(claim: RunClaim, ctx: RunCheckContext): { flags: RunFlag[]; claim: RunClaim } {
  const { cfg } = ctx;
  const flags: RunFlag[] = [];
  const seconds = claim.ticks / 60;
  if (seconds > ctx.wallSeconds + cfg.caps.slackSeconds) flags.push('too_fast');
  if (claim.depth > 1 + Math.floor(claim.ticks / (ctx.layerSeconds * 60))) flags.push('depth_vs_time');
  if (claim.kills > cfg.caps.killsPerMinute * (seconds / 60) + 50) flags.push('kills_rate');
  const bossOk =
    claim.bossKills <= claim.depth && claim.bossKills >= claim.depth - 1 && (claim.outcome !== 'extracted' || claim.bossKills === claim.depth);
  if (!bossOk) flags.push('boss_kills');
  if (ctx.logTicks !== null && ctx.logTicks > claim.ticks) flags.push('log_mismatch');
  const coinCap = claim.kills * cfg.caps.coinsPerKill + claim.bossKills * cfg.caps.bossCoins + 5;
  const dustCap = claim.kills * cfg.caps.dustPerKill + claim.bossKills * cfg.caps.bossDust + 5;
  const coins = clip(
    claim.loot.map((l) => l.coins),
    Math.floor(coinCap),
  );
  const dust = clip(
    claim.loot.map((l) => l.dust),
    Math.floor(dustCap),
  );
  const clipped = coins.some((c, i) => c !== claim.loot[i]!.coins) || dust.some((d, i) => d !== claim.loot[i]!.dust);
  if (clipped) flags.push('loot_cap');
  return { flags, claim: clipped ? { ...claim, loot: claim.loot.map((_, i) => ({ coins: coins[i]!, dust: dust[i]! })) } : claim };
}
