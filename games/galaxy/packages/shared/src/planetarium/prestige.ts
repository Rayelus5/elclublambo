import type { ConfigValue } from '../config/registry';
import { type Finish, type Tier, TIERS } from '../gacha/types';

// The planetarium's prestige (GDD §10.5; M4c-2): each exhibited galaxy adds points by its tier, and one more for a
// finish that is not normal. Prestige becomes a small experience bonus in runs, capped (5 % at most).

export type PlanetariumConfig = ConfigValue<'planetarium'>;

export function prestige(exhibits: readonly { tier: Tier; finish: Finish }[], cfg: PlanetariumConfig): number {
  let points = 0;
  for (const g of exhibits) points += (cfg.points.tiers[TIERS.indexOf(g.tier)] ?? 0) + (g.finish === 'normal' ? 0 : cfg.points.finish);
  return points;
}

/** The experience bonus of `points` of prestige (a fraction: 0.016 = 1.6 %), never above the cap. */
export function planetariumBonus(points: number, cfg: PlanetariumConfig): number {
  return Math.round(Math.min(cfg.cap, Math.max(0, points) * cfg.xpPerPoint) * 10_000) / 10_000;
}
