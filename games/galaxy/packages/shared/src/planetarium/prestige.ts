import type { ConfigValue } from '../config/registry';
import { type Finish, perTier, type Tier, TIERS } from '../gacha/types';

// The planetarium's prestige (GDD §10.5; M4c-2): each exhibited galaxy adds points by its tier, and one more for a
// finish that is not normal. Prestige becomes a small experience bonus in runs, capped (5 % at most).

export type PlanetariumConfig = ConfigValue<'planetarium'>;

/** The prestige of the exhibited galaxies (a config published before the mythic gives it the legendary's points). */
export function prestige(exhibits: readonly { tier: Tier; finish: Finish }[], cfg: PlanetariumConfig): number {
  const tiers = perTier(cfg.points.tiers);
  let points = 0;
  for (const g of exhibits) points += (tiers[TIERS.indexOf(g.tier)] ?? 0) + (g.finish === 'normal' ? 0 : cfg.points.finish);
  return points;
}

/** The experience bonus of `points` of prestige (a fraction: 0.016 = 1.6 %), never above the cap. */
export function planetariumBonus(points: number, cfg: PlanetariumConfig): number {
  return Math.round(Math.min(cfg.cap, Math.max(0, points) * cfg.xpPerPoint) * 10_000) / 10_000;
}
