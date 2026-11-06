import { subRng } from '@galaxy/engine';
import type { ConfigValue } from '../config/registry';
import { FINISHES, type Finish } from './types';

// Deep-scan rules (GDD §9), pure: what a pull gives, from its 64-bit seed and the account's luck state. The server
// supplies the seed (crypto) and stores the state; every random number comes from the engine's subRng streams.
export type GachaConfig = ConfigValue<'gacha'>;
export type GalaxiesConfig = ConfigValue<'galaxies'>;
export type Banner = GachaConfig['banners'][number];
export type Pity = { base: number; softStart: number; softStep: number; hard: number };

export interface PityState {
  /** Pulls since the last legendary in this pity group. */
  sinceLegendary: number;
  /** Event banners: pulls since the last featured galaxy (kept across events of the same group). */
  sinceFeatured: number;
  /** A new account's welcome luck, until its first legendary. */
  welcome: boolean;
}

/** Chance that pull n (1-based since the last hit) hits: rising from softStart, guaranteed at hard. */
export function legendaryChance(n: number, pity: Pity): number {
  if (n >= pity.hard) return 1;
  return Math.min(1, pity.base + Math.max(0, n - pity.softStart + 1) * pity.softStep);
}

/**
 * Probability of each tier (common → legendary) on the next pull. The legendary chance comes from the luck curve
 * (welcome or standard); the other four share the rest in the proportions of `tiers.base`.
 */
export function tierWeights(state: PityState, cfg: GachaConfig): number[] {
  const legendary = legendaryChance(state.sinceLegendary + 1, state.welcome ? cfg.welcome : cfg.standard);
  const others = cfg.tiers.base.slice(0, 4);
  const sum = others.reduce((a, b) => a + b, 0);
  return [...others.map((p) => (p / sum) * (1 - legendary)), legendary];
}

export interface PullOutcome {
  tier: number;
  featured: boolean;
  finish: Finish;
  state: PityState;
}

/**
 * One pull. Streams: "featured" (event banners only), "tier", "finish". A featured galaxy is a legendary with the
 * banner's featured trait; any legendary resets the legendary counter and ends the welcome luck.
 */
export function drawPull(pullSeed: bigint, state: PityState, banner: Banner, cfg: GachaConfig): PullOutcome {
  const featured =
    banner.kind === 'event' && subRng(pullSeed, 'featured').random() < legendaryChance(state.sinceFeatured + 1, cfg.featured);
  const tier = featured ? 4 : subRng(pullSeed, 'tier').choiceP(tierWeights(state, cfg));
  const finish = drawFinish(pullSeed, cfg);
  return {
    tier,
    featured,
    finish,
    state: {
      sinceLegendary: tier === 4 ? 0 : state.sinceLegendary + 1,
      sinceFeatured: banner.kind === 'event' ? (featured ? 0 : state.sinceFeatured + 1) : state.sinceFeatured,
      welcome: state.welcome && tier !== 4,
    },
  };
}

/** The card finish of a pull or a fusion (stream "finish"): purely cosmetic (GDD §7). */
export function drawFinish(seed: bigint, cfg: GachaConfig): Finish {
  return FINISHES[subRng(seed, 'finish').choiceP(cfg.finishes)]!;
}

/** What the scanner shows before a pull: next rates and the counters to the guarantees (GDD §9 transparency). */
export function bannerOdds(state: PityState, banner: Banner, cfg: GachaConfig) {
  const pity = state.welcome ? cfg.welcome : cfg.standard;
  return {
    nextRates: tierWeights(state, cfg),
    sinceLegendary: state.sinceLegendary,
    untilGuarantee: Math.max(1, pity.hard - state.sinceLegendary),
    welcome: state.welcome,
    ...(banner.kind === 'event' ? { untilFeatured: Math.max(1, cfg.featured.hard - state.sinceFeatured) } : {}),
  };
}

/** Star dust for disintegrating a galaxy: per tier × finish multiplier (GDD §8.5). */
export function disintegrateYield(tier: number, finish: Finish, cfg: GalaxiesConfig): number {
  return Math.round(cfg.disintegrate.tier[tier]! * cfg.disintegrate.finish[FINISHES.indexOf(finish)]!);
}

/** Fusion: `fusion.count` distinct galaxies of the same tier (below legendary) → one of the next tier, for dust. */
export function validateFusion(
  galaxies: ReadonlyArray<{ id: string; tier: number }>,
  cfg: GalaxiesConfig,
): { tier: number; dust: number } | { error: 'invalid_fusion' } {
  const tier = galaxies[0]?.tier;
  const valid =
    tier !== undefined &&
    tier < 4 &&
    galaxies.length === cfg.fusion.count &&
    new Set(galaxies.map((g) => g.id)).size === galaxies.length &&
    galaxies.every((g) => g.tier === tier);
  return valid ? { tier: tier + 1, dust: cfg.fusion.dust[tier]! } : { error: 'invalid_fusion' };
}
