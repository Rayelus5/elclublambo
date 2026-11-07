import { z } from 'zod';

// Galaxy rarity tiers and card finishes (GDD §7), in order: index = tier/finish code stored in the database.
export const TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Tier = (typeof TIERS)[number];

export const FINISHES = ['normal', 'holo', 'prismatic', 'braille', 'corrupt'] as const;
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
