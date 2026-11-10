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

/**
 * A season's exclusive finish (GDD §13.1; M8c), stream "season-finish": with the season's chance a pull in its open season
 * carries it instead of the one drawn. Purely cosmetic, like every finish.
 */
export function seasonFinish(pullSeed: bigint, season: { finish: Finish | null; finishChance: number } | null): Finish | null {
  if (!season?.finish || !(season.finishChance > 0)) return null;
  return subRng(pullSeed, 'season-finish').random() < season.finishChance ? season.finish : null;
}

/** The card finish of a pull or a fusion (stream "finish"): purely cosmetic (GDD §7). */
export function drawFinish(seed: bigint, cfg: GachaConfig): Finish {
  return FINISHES[subRng(seed, 'finish').choiceP(cfg.finishes)]!;
}

/**
 * Whether an event's own signals (`signal:<event>`) can still be spent or earned: some scanner paying with them is
 * open or yet to open, or the event of that id has not ended. Once neither, what a player has left turns into star
 * dust (open beta; `leftoverDust` each).
 */
export function eventCurrencyAlive(
  currency: string,
  banners: readonly { currency: string; endsAt?: string | undefined }[],
  events: readonly { id: string; endsAt: string }[],
  now: Date,
): boolean {
  const t = now.getTime();
  if (banners.some((b) => b.currency === currency && (!b.endsAt || Date.parse(b.endsAt) > t))) return true;
  return events.some((e) => `signal:${e.id}` === currency && Date.parse(e.endsAt) > t);
}

/** What the scanner shows before a pull: next rates and the counters to the guarantees (GDD §9 transparency). */
export function bannerOdds(state: PityState, banner: Banner, cfg: GachaConfig) {
  const pity = state.welcome ? cfg.welcome : cfg.standard;
  return {
    nextRates: tierWeights(state, cfg),
    sinceLegendary: state.sinceLegendary,
    untilGuarantee: Math.max(1, pity.hard - state.sinceLegendary),
    welcome: state.welcome,
    ...(banner.kind === 'event' ? { untilFeatured: Math.max(1, cfg.featured.hard - state.sinceFeatured), featuredEvery: cfg.featured.hard } : {}),
  };
}

/** Star dust for disintegrating a galaxy: per tier × finish multiplier (GDD §8.5). */
export function disintegrateYield(tier: number, finish: Finish, cfg: GalaxiesConfig): number {
  // A season's finish (M8c) has no weight of its own: it yields like the rarest drawn one.
  const f = cfg.disintegrate.finish;
  return Math.round(cfg.disintegrate.tier[tier]! * (f[FINISHES.indexOf(finish)] ?? f[f.length - 1]!));
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
