import type { ConfigValue } from '../config/registry';
import { dailyFactor, dailySegments, runMaterial, runPayout } from '../runs/rewards';
import { type BoostsConfig, boostFactor } from './boosts';

// The economy simulator (GDD §16.6; M6d-5): what sample runs (played by the simulation's bot) pay under a runs and a
// boosts config, per run and over a day of play with the daily yield — the same rules finishRun pays with, so the
// live config and a draft can be compared before publishing. The signals are the expected ones (chance × Cores).

type RunsConfig = ConfigValue<'runs'>;
export interface EconomySample {
  outcome: 'extracted' | 'died' | 'abandoned';
  ticks: number;
  depth: number;
  kills: number;
  bossKills: number;
  level: number;
  loot: { coins: number; dust: number }[];
}
export interface EconomyPay {
  coins: number;
  dust: number;
  material: number;
  signals: number;
}
export interface EconomyResult {
  /** The average sample run, at the full daily rate. */
  perRun: EconomyPay;
  /** A day of `minutesPerDay` of play: the samples one after another, through the daily yield. */
  perDay: EconomyPay & { runs: number };
  /** How many sample runs hit a per-run cap. */
  capped: number;
}

const ZERO: EconomyPay = { coins: 0, dust: 0, material: 0, signals: 0 };

function payOf(s: EconomySample, runs: RunsConfig, boosts: BoostsConfig, at: Date, factor: number): EconomyPay & { capped: boolean } {
  const g = (c: 'coins' | 'dust' | 'material' | 'signal') => boostFactor(boosts, c, at);
  const claim = { ...s, hash: '0000000000000000' };
  const pay = runPayout(claim, runs, factor, false, { coins: 0, dust: 0 }, { coins: g('coins'), dust: g('dust') });
  const material = runMaterial(claim, runs, factor, false, 0, g('material'));
  const signals = s.bossKills * Math.min(1, runs.signalChancePerBoss * factor * g('signal'));
  return { coins: pay.coins, dust: pay.dust, material, signals, capped: pay.capped };
}

const add = (a: EconomyPay, b: EconomyPay): EconomyPay => ({ coins: a.coins + b.coins, dust: a.dust + b.dust, material: a.material + b.material, signals: a.signals + b.signals });

export function simulateEconomy(samples: readonly EconomySample[], runs: RunsConfig, boosts: BoostsConfig, opts: { minutesPerDay: number; at: Date }): EconomyResult {
  if (samples.length === 0) return { perRun: ZERO, perDay: { ...ZERO, runs: 0 }, capped: 0 };
  let total = ZERO;
  let capped = 0;
  for (const s of samples) {
    const p = payOf(s, runs, boosts, opts.at, 1);
    total = add(total, p);
    if (p.capped) capped++;
  }
  const n = samples.length;
  const perRun = { coins: total.coins / n, dust: total.dust / n, material: total.material / n, signals: total.signals / n };
  // A day: the samples in turn until the minutes run out, each through the daily yield from where the day stands.
  let day = ZERO;
  let played = 0;
  let count = 0;
  const budget = Math.max(0, opts.minutesPerDay * 60);
  while (count < 10_000) {
    const s = samples[count % n]!;
    const seconds = Math.max(1, Math.round(s.ticks / 60));
    if (played + seconds > budget) break;
    const factor = dailyFactor(dailySegments(played, seconds, runs));
    day = add(day, payOf(s, runs, boosts, opts.at, factor));
    played += seconds;
    count++;
  }
  return { perRun, perDay: { ...day, runs: count }, capped };
}
