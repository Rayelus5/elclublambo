import type { ConfigValue } from '../config/registry';
import type { Tier } from '../gacha/types';

// The market (GDD §14.6, §14.7; M5c-1): what a galaxy may cost at least, what the market keeps of a sale, and who may
// trade. The server applies them; the web shows them before anyone presses a button.

export type MarketConfig = ConfigValue<'market'>;

const DAY_MS = 86_400_000;

/**
 * The lowest price a galaxy of this rarity can be listed for (a trigger enforces it too). A market config published
 * before the mythic has no floor for it: the legendary's.
 */
export function minPriceFor(tier: Tier, cfg: MarketConfig): number {
  return tier === 'mythic' ? (cfg.minPrice.mythic ?? cfg.minPrice.legendary) : cfg.minPrice[tier];
}

/** Whether a galaxy of this rarity may be put up for sale: a mythic only when the market allows it (`mythicListing`). */
export function listable(tier: Tier, cfg: MarketConfig): boolean {
  return tier !== 'mythic' || cfg.mythicListing;
}

/** What the market keeps of a sale: the rate rounded down, at least one coin (none when the rate is 0). */
export function commissionOf(price: number, rate: number): number {
  return rate === 0 ? 0 : Math.max(1, Math.floor(price * rate));
}

/** Why an account cannot trade yet: its level first, then the age of the account; null when it can. */
export function tradeBlock(level: number, accountCreatedAt: Date, now: Date, cfg: MarketConfig): 'level' | 'age' | null {
  if (level < cfg.minLevel) return 'level';
  if (now.getTime() - accountCreatedAt.getTime() < cfg.minAccountDays * DAY_MS) return 'age';
  return null;
}
