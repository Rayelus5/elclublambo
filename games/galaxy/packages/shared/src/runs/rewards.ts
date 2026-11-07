import type { RunClaim, RunLayerPay } from '../api/runs';
import type { ConfigValue } from '../config/registry';

// What a run pays (GDD §5.1, §11.3 bis). Loot counts by the depth of the layer it was picked up in; a run that ends
// without extraction keeps `deathShare`; the daily yield prorates the run's minutes over the day's thresholds. The
// server applies all of it; the client only shows it.

export type RunsConfig = ConfigValue<'runs'>;

/** ×table[layer − 1], then + step for each layer past the table. */
export function depthMultiplier(layer: number, cfg: RunsConfig): number {
  const t = cfg.depth.table;
  if (layer <= t.length) return t[Math.max(1, layer) - 1]!;
  return t[t.length - 1]! + cfg.depth.step * (layer - t.length);
}

export interface DailySegment {
  seconds: number;
  multiplier: number;
}

/** Splits a run of `seconds`, played after `playedBefore` seconds today, over the daily tiers. */
export function dailySegments(playedBefore: number, seconds: number, cfg: RunsConfig): DailySegment[] {
  const bounds = cfg.daily.hours.map((h) => h * 3600);
  const out: DailySegment[] = [];
  let at = Math.max(0, playedBefore);
  let left = Math.max(0, seconds);
  while (left > 0) {
    const tier = bounds.findIndex((b) => at < b);
    const multiplier = cfg.daily.multipliers[tier < 0 ? bounds.length : tier]!;
    const room = tier < 0 ? left : bounds[tier]! - at;
    const take = Math.min(left, room);
    const last = out[out.length - 1];
    if (last && last.multiplier === multiplier) last.seconds += take;
    else out.push({ seconds: take, multiplier });
    at += take;
    left -= take;
  }
  return out;
}

/** The time-weighted multiplier of a run's segments (1 for an empty run). */
export function dailyFactor(segments: readonly DailySegment[]): number {
  const total = segments.reduce((a, s) => a + s.seconds, 0);
  if (total <= 0) return 1;
  return segments.reduce((a, s) => a + s.seconds * s.multiplier, 0) / total;
}

/** Today's standing: time played, time left at the full rate, and the current rate. */
export function dailyStatus(playedSeconds: number, cfg: RunsConfig): { playedSeconds: number; fullSecondsLeft: number; multiplier: number } {
  const first = cfg.daily.hours[0]! * 3600;
  const bounds = cfg.daily.hours.map((h) => h * 3600);
  const tier = bounds.findIndex((b) => playedSeconds < b);
  return {
    playedSeconds,
    fullSecondsLeft: Math.max(0, first - playedSeconds),
    multiplier: cfg.daily.multipliers[tier < 0 ? bounds.length : tier]!,
  };
}

export interface RunPayout {
  coins: number;
  dust: number;
  layers: RunLayerPay[];
  share: number;
}

/** Coins and dust a run pays, given the daily factor of its minutes. */
export function runPayout(claim: RunClaim, cfg: RunsConfig, factor: number): RunPayout {
  const share = claim.outcome === 'extracted' ? 1 : cfg.deathShare;
  let coins = 0;
  let dust = 0;
  const layers = claim.loot.map((l, i) => {
    const multiplier = depthMultiplier(i + 1, cfg);
    coins += l.coins * multiplier;
    dust += l.dust * multiplier;
    return { layer: i + 1, coins: l.coins, dust: l.dust, multiplier };
  });
  const k = share * factor;
  return { coins: Math.floor(coins * k + 1e-9), dust: Math.floor(dust * k + 1e-9), layers, share };
}
