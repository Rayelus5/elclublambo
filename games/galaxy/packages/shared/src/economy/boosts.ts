import type { ConfigValue } from '../config/registry';

// Temporary global multipliers (GDD §16.3; M6d-5): the boosts running at a moment, and the multiplier of one currency.

export type BoostsConfig = ConfigValue<'boosts'>;
export type Boost = BoostsConfig['list'][number];
export type BoostCurrency = Boost['currency'];

/** The boosts running now, as players see them (GET /galaxy/api/boosts). */
export interface BoostsView {
  boosts: { id: string; name: string; currency: BoostCurrency; factor: number; endsAt: string }[];
}

/** The most boosts on one currency multiply to, together. */
export const MAX_BOOST = 5;

/** The boosts whose window holds `now` (start included, end not). */
export function activeBoosts(cfg: BoostsConfig, now: Date): Boost[] {
  const t = now.getTime();
  return cfg.list.filter((b) => t >= Date.parse(b.startsAt) && t < Date.parse(b.endsAt));
}

/** What one currency is multiplied by at `now`: the running boosts on it, multiplied, at most ×5. */
export function boostFactor(cfg: BoostsConfig, currency: BoostCurrency, now: Date): number {
  const f = activeBoosts(cfg, now)
    .filter((b) => b.currency === currency)
    .reduce((a, b) => a * b.factor, 1);
  return Math.min(MAX_BOOST, f);
}
