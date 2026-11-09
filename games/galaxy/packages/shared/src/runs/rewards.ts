import type { RunClaim, RunLayerPay } from '../api/runs';
import type { ConfigValue } from '../config/registry';

// What a run pays (GDD §5.1, §11.3 bis). Loot counts by the depth of the layer it was picked up in; a run that ends
// without extraction (or flagged as forged) keeps `deathShare`; the daily yield prorates the run's minutes over the
// day's thresholds, and no run pays more than `caps.runCoins` / `caps.runDust` until replays verify runs (M5). The
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
  /** The run hit the per-run ceiling. */
  capped: boolean;
}

/** Coins and dust a run pays, given the daily factor of its minutes; `penalized` pays the death share. */
/** Raw material a run brings (GDD §10.3): from its depth, Cores and kills, paid like the loot (share, daily yield, cap). */
/** The run's raw material; the Laboratorio's `boost` (a fraction added, M4b-2) applies before the cap. */
/** `global`: the boosts' multiplier on material (M6d-5), applied before the per-run cap like the Laboratorio's push. */
export function runMaterial(claim: RunClaim, cfg: RunsConfig, factor: number, penalized = false, boost = 0, global = 1): number {
  const share = claim.outcome === 'extracted' && !penalized ? 1 : cfg.deathShare;
  const m = cfg.material;
  const raw = claim.depth * m.perLayer + claim.bossKills * m.perBoss + (claim.kills / 100) * m.perHundredKills;
  return Math.min(Math.floor(raw * share * factor * (1 + boost) * global + 1e-9), cfg.caps.runMaterial);
}

/**
 * Components from the run's breakable props (SIM 1.7.0): what was picked up, paid like the material (share, daily
 * yield, global boosts) and capped per run. Depth does not multiply them.
 */
export function runComponents(claim: RunClaim, cfg: RunsConfig, factor: number, penalized = false, global = 1): number {
  const share = claim.outcome === 'extracted' && !penalized ? 1 : cfg.deathShare;
  const raw = claim.loot.reduce((a, l) => a + (l.components ?? 0), 0);
  return Math.min(Math.floor(raw * share * factor * global + 1e-9), cfg.caps.runComponents);
}

/** The Laboratorio's push on a run's coins and dust (fractions added, M4b-2), applied before the per-run caps. */
export type PayoutBoost = { coins: number; dust: number };

/** `global`: the boosts' multipliers (M6d-5), applied before the per-run caps. */
export function runPayout(
  claim: RunClaim,
  cfg: RunsConfig,
  factor: number,
  penalized = false,
  boost: PayoutBoost = { coins: 0, dust: 0 },
  global: { coins: number; dust: number } = { coins: 1, dust: 1 },
): RunPayout {
  const share = claim.outcome === 'extracted' && !penalized ? 1 : cfg.deathShare;
  let coins = 0;
  let dust = 0;
  const layers = claim.loot.map((l, i) => {
    const multiplier = depthMultiplier(i + 1, cfg);
    coins += l.coins * multiplier;
    dust += l.dust * multiplier;
    return { layer: i + 1, coins: l.coins, dust: l.dust, multiplier };
  });
  const k = share * factor;
  const paidCoins = Math.floor(coins * k * (1 + boost.coins) * global.coins + 1e-9);
  const paidDust = Math.floor(dust * k * (1 + boost.dust) * global.dust + 1e-9);
  return {
    coins: Math.min(paidCoins, cfg.caps.runCoins),
    dust: Math.min(paidDust, cfg.caps.runDust),
    layers,
    share,
    capped: paidCoins > cfg.caps.runCoins || paidDust > cfg.caps.runDust,
  };
}
