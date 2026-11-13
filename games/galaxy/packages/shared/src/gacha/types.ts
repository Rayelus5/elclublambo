import { z } from 'zod';

// Galaxy rarity tiers and card finishes (GDD §7), in order: index = tier/finish code stored in the database.
// The «Mítica» (plan «rareza Mítica» M1) is the sixth: only the deep scan's own mythic draw gives one (never the
// guarantee, never a fusion), so anything that treats the legendary as the top asks for «legendary or better».
export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Tier = (typeof TIERS)[number];
/** Tier index of the legendary: what the guarantee gives and what resets it. */
export const LEGENDARY = 4;
/** Tier index of the mythic. */
export const MYTHIC = 5;
/** The highest tier a fusion makes: galaxies of this tier or better are never fused. */
export const FUSION_TOP = LEGENDARY;

/** Whether `tier` (a name or its index) is `min` or better: «legendary or better» counts the mythic too. */
export function atLeast(tier: Tier | number, min: Tier): boolean {
  return (typeof tier === 'number' ? tier : TIERS.indexOf(tier)) >= TIERS.indexOf(min);
}

/**
 * A per-tier list of a live config (dust, prestige, relic power…) for every tier: one published before the mythic
 * stops at the legendary, and the missing tiers repeat its last value.
 */
export function perTier<T>(values: readonly T[]): T[] {
  const out = values.slice(0, TIERS.length);
  while (out.length > 0 && out.length < TIERS.length) out.push(out[out.length - 1]!);
  return out;
}

export const FINISHES = ['normal', 'holo', 'prismatic', 'braille', 'corrupt', 'rift'] as const;
/**
 * The finishes the deep scan's odds draw (config `gacha.finishes`, one weight each). The rest are a season's exclusive
 * finish (M8c): only a pull in that open season can carry it.
 */
export const DRAWN_FINISHES = ['normal', 'holo', 'prismatic', 'braille', 'corrupt'] as const;
export const SEASON_FINISHES = ['rift'] as const;
export type Finish = (typeof FINISHES)[number];

/** Engine traits a banner can feature (packages/engine draw order). */
export const TRAIT_KEYS = [
  'galaxy_type',
  'arms',
  'size',
  'inclination',
  'core',
  'star_density',
  'palette',
  'background',
  'phenomenon',
] as const;
export type FeaturedTrait = (typeof TRAIT_KEYS)[number];

/**
 * Coins, star dust, galaxy signals (tickets), event signals (`signal:<group>`, only valid on their banners), and the
 * station's raw material and components (M4a).
 */
export type Currency = 'coins' | 'dust' | 'signal' | `signal:${string}` | 'material' | 'components';
export const currencySchema = z.union([
  z.enum(['coins', 'dust', 'signal', 'material', 'components']),
  z.string().regex(/^signal:[a-z0-9-]{1,32}$/) as z.ZodType<`signal:${string}`>,
]);

export type Wallet = Record<string, number> & { coins: number; dust: number; signal: number };
