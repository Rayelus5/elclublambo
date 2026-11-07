import type { ConfigValue } from '../config/registry';
import type { RunProgressInput } from './account';

// The season (GDD §13.1, §14.1; M5a): the points each run that is not suspicious adds while the season is open
// (per layer, per Core, for extracting), and the tier of a score, Bronce to Estelar. Missions, achievements and the
// catalogue add their points with M7.

export type SeasonConfig = ConfigValue<'season'>;
export const SEASON_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'stellar'] as const;
export type SeasonTier = (typeof SEASON_TIERS)[number];

export function seasonPoints(run: RunProgressInput, cfg: SeasonConfig): number {
  return (
    Math.max(0, Math.floor(run.depth)) * cfg.points.layer +
    Math.max(0, Math.floor(run.bossKills)) * cfg.points.core +
    (run.outcome === 'extracted' ? cfg.points.extraction : 0)
  );
}

/** The highest tier the score reaches, or null under the first. */
export function seasonTier(score: number, cfg: SeasonConfig): SeasonTier | null {
  let tier: SeasonTier | null = null;
  cfg.tiers.forEach((at, i) => {
    if (score >= at) tier = SEASON_TIERS[i]!;
  });
  return tier;
}

/** Open from its start (included) to its end (excluded). */
export function seasonOpen(cfg: SeasonConfig, now: Date): boolean {
  const t = now.getTime();
  return t >= Date.parse(cfg.startsAt) && t < Date.parse(cfg.endsAt);
}
