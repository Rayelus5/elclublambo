import type { RunClaim } from '../api/runs';
import type { RunsConfig } from './rewards';

// Plausibility of a finished run (GDD §14.7). The run is simulated by the client, so the server checks that the claim
// could have happened: time against the wall clock, depth against time, kill rate, boss kills against the layers,
// the input log against the claimed end, and loot against what the kills could drop. A failed check flags the run
// (it does not score), and the claim is clipped to what fits in the real time before anything is paid: playing time
// to the wall clock, depth to that time (the loot of extra layers is lost), kills to the top rate, boss kills to the
// depth and loot to what those kills drop. A cheating flag also pays only the death share. Replaying the inputs
// comes later (M5).

export type RunFlag = 'too_fast' | 'depth_vs_time' | 'kills_rate' | 'boss_kills' | 'log_mismatch' | 'loot_cap' | 'payout_cap' | 'coop_idle';

/** Flags that point at a forged claim rather than a lucky one: the run pays only the death share. */
const CHEATING: readonly RunFlag[] = ['too_fast', 'depth_vs_time', 'kills_rate', 'boss_kills', 'log_mismatch'];

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

export function checkRun(claim: RunClaim, ctx: RunCheckContext): { flags: RunFlag[]; claim: RunClaim; penalized: boolean } {
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

  // What fits in the real time: nothing below is computed from the raw claim.
  const ticks = Math.max(0, Math.min(claim.ticks, Math.floor((Math.max(0, ctx.wallSeconds) + cfg.caps.slackSeconds) * 60)));
  const depth = Math.max(1, Math.min(claim.depth, 1 + Math.floor(ticks / (ctx.layerSeconds * 60))));
  const kills = Math.min(claim.kills, Math.floor(cfg.caps.killsPerMinute * (ticks / 3600)) + 50);
  const bossKills = Math.min(claim.bossKills, depth);
  const loot = claim.loot.slice(0, depth);
  const coinCap = kills * cfg.caps.coinsPerKill + bossKills * cfg.caps.bossCoins + 5;
  const minutes = ticks / 3600;
  const dustCap = kills * cfg.caps.dustPerKill + bossKills * cfg.caps.bossDust + minutes * cfg.caps.propDustPerMinute + 5;
  const componentCap = minutes * cfg.caps.componentsPerMinute + 2;
  const coins = clip(
    loot.map((l) => l.coins),
    Math.floor(coinCap),
  );
  const dust = clip(
    loot.map((l) => l.dust),
    Math.floor(dustCap),
  );
  const components = clip(
    loot.map((l) => l.components ?? 0),
    Math.floor(componentCap),
  );
  if (
    coins.some((c, i) => c !== loot[i]!.coins) ||
    dust.some((d, i) => d !== loot[i]!.dust) ||
    components.some((c, i) => c !== (loot[i]!.components ?? 0))
  )
    flags.push('loot_cap');
  const same =
    ticks === claim.ticks && depth === claim.depth && kills === claim.kills && bossKills === claim.bossKills && !flags.includes('loot_cap');
  return {
    flags,
    claim: same
      ? claim
      : { ...claim, ticks, depth, kills, bossKills, loot: loot.map((_, i) => ({ coins: coins[i]!, dust: dust[i]!, components: components[i]! })) },
    penalized: flags.some((f) => CHEATING.includes(f)),
  };
}
