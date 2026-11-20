import { subRng } from '@galaxy/engine';
import type { ConfigValue } from '../config/registry';
import { DRAWN_FINISHES, FINISHES, type Finish, FUSION_TOP, LEGENDARY, MYTHIC, perTier } from './types';

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
 * Probability of each tier (common → legendary) in the normal tier roll of the next pull. The legendary chance comes
 * from the luck curve (welcome or standard); the other four share the rest in the proportions of `tiers.base`. The
 * mythic is not here: it is drawn before, on its own stream (tierRates gives the six together).
 */
export function tierWeights(state: PityState, cfg: GachaConfig): number[] {
  const legendary = legendaryChance(state.sinceLegendary + 1, state.welcome ? cfg.welcome : cfg.standard);
  const others = cfg.tiers.base.slice(0, 4);
  const sum = others.reduce((a, b) => a + b, 0);
  return [...others.map((p) => (p / sum) * (1 - legendary)), legendary];
}

/** Probability of each of the six tiers (common → mythic) on the next pull: the mythic first, the rest after it. */
export function tierRates(state: PityState, cfg: GachaConfig): number[] {
  const m = cfg.mythic;
  return [...tierWeights(state, cfg).map((p) => p * (1 - m)), m];
}

export interface PullOutcome {
  tier: number;
  featured: boolean;
  finish: Finish;
  state: PityState;
}

/**
 * One pull. Streams: "mythic", "featured" (event banners only), "tier", "finish". The mythic is drawn first, on its
 * own stream and with its own chance (`gacha.mythic`, never raised by the luck): while that chance is 0 every pull
 * gives what it gave before the mythic existed. A mythic is not the featured galaxy, always has a special finish, and
 * counts as a legendary for the luck. A featured galaxy is a legendary with the banner's featured trait; any
 * legendary (or mythic) resets the legendary counter and ends the welcome luck.
 */
export function drawPull(pullSeed: bigint, state: PityState, banner: Banner, cfg: GachaConfig): PullOutcome {
  const mythic = cfg.mythic > 0 && subRng(pullSeed, 'mythic').random() < cfg.mythic;
  const featured =
    !mythic && banner.kind === 'event' && subRng(pullSeed, 'featured').random() < legendaryChance(state.sinceFeatured + 1, cfg.featured);
  const tier = mythic ? MYTHIC : featured ? LEGENDARY : subRng(pullSeed, 'tier').choiceP(tierWeights(state, cfg));
  const finish = mythic ? drawSpecialFinish(pullSeed, cfg) : drawFinish(pullSeed, cfg);
  return {
    tier,
    featured,
    finish,
    state: {
      sinceLegendary: tier >= LEGENDARY ? 0 : state.sinceLegendary + 1,
      sinceFeatured: banner.kind === 'event' ? (featured ? 0 : state.sinceFeatured + 1) : state.sinceFeatured,
      welcome: state.welcome && tier < LEGENDARY,
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
 * A mythic's finish (stream "finish"): one of the drawn finishes but the plain one, in the proportions of
 * `gacha.finishes` (evenly if those leave nothing to the special ones).
 */
export function drawSpecialFinish(seed: bigint, cfg: GachaConfig): Finish {
  const special = cfg.finishes.slice(1, DRAWN_FINISHES.length);
  const sum = special.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? special.map((p) => p / sum) : special.map(() => 1 / special.length);
  return DRAWN_FINISHES[1 + subRng(seed, 'finish').choiceP(weights)]!;
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
    nextRates: tierRates(state, cfg),
    sinceLegendary: state.sinceLegendary,
    untilGuarantee: Math.max(1, pity.hard - state.sinceLegendary),
    welcome: state.welcome,
    ...(banner.kind === 'event' ? { untilFeatured: Math.max(1, cfg.featured.hard - state.sinceFeatured), featuredEvery: cfg.featured.hard } : {}),
  };
}

/** Star dust for disintegrating a galaxy: per tier × finish multiplier (GDD §8.5). */
export function disintegrateYield(tier: number, finish: Finish, cfg: GalaxiesConfig): number {
  // A season's finish (M8c) has no weight of its own: it yields like the rarest drawn one. A config published before
  // the mythic yields for it as for a legendary.
  const f = cfg.disintegrate.finish;
  return Math.round(perTier(cfg.disintegrate.tier)[tier]! * (f[FINISHES.indexOf(finish)] ?? f[f.length - 1]!));
}

/**
 * Fusion: `fusion.count` distinct galaxies of the same tier (below legendary) → one of the next tier, for dust. It
 * never makes a mythic, and a legendary or a mythic is never fused (FUSION_TOP).
 */
export function validateFusion(
  galaxies: ReadonlyArray<{ id: string; tier: number }>,
  cfg: GalaxiesConfig,
): { tier: number; dust: number } | { error: 'invalid_fusion' } {
  const tier = galaxies[0]?.tier;
  const valid =
    tier !== undefined &&
    tier < FUSION_TOP &&
    galaxies.length === cfg.fusion.count &&
    new Set(galaxies.map((g) => g.id)).size === galaxies.length &&
    galaxies.every((g) => g.tier === tier);
  return valid ? { tier: tier + 1, dust: cfg.fusion.dust[tier]! } : { error: 'invalid_fusion' };
}
