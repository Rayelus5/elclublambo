import type { ConfigValue } from '../config/registry';
import { type RunProgressInput, runCounts } from './account';

// The season (GDD §13.1, §14.1; M5a): the points each run that is not suspicious adds while the season is open
// (per layer, per Core, for extracting), and the tier of a score, Bronce to Estelar. Missions, achievements and the
// catalogue add their points with M7.

export type SeasonConfig = ConfigValue<'season'>;
export const SEASON_TIERS = ['bronze', 'silver', 'gold', 'platinum', 'stellar'] as const;
export type SeasonTier = (typeof SEASON_TIERS)[number];

/**
 * The points a run adds: per layer, per Core and for extracting, never more than `capPerMinute` per minute it lasted.
 * A run counts from the account's `minRunSeconds` (default 60).
 */
export function seasonPoints(run: RunProgressInput, cfg: SeasonConfig, minRunSeconds = 60): number {
  if (!runCounts(run, minRunSeconds)) return 0;
  const earned =
    Math.max(0, Math.floor(run.depth)) * cfg.points.layer +
    Math.max(0, Math.floor(run.bossKills)) * cfg.points.core +
    (run.outcome === 'extracted' ? cfg.points.extraction : 0);
  return Math.min(earned, Math.floor((Math.max(0, run.seconds) * cfg.capPerMinute) / 60));
}

/** The highest tier the score reaches, or null under the first. */
export function seasonTier(score: number, cfg: SeasonConfig): SeasonTier | null {
  let tier: SeasonTier | null = null;
  cfg.tiers.forEach((at, i) => {
    if (score >= at) tier = SEASON_TIERS[i]!;
  });
  return tier;
}

/** The season's anomaly changing every run now (M7d-3): only while the season is open and if the content has it. */
export function activeAnomaly(cfg: SeasonConfig, content: { anomalies: { id: string; name: string; description: string }[] }, now: Date) {
  if (!cfg.anomaly || !seasonOpen(cfg, now)) return null;
  return content.anomalies.find((a) => a.id === cfg.anomaly) ?? null;
}

/** Open from its start (included) to its end (excluded). */
export function seasonOpen(cfg: SeasonConfig, now: Date): boolean {
  const t = now.getTime();
  return t >= Date.parse(cfg.startsAt) && t < Date.parse(cfg.endsAt);
}
