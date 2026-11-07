import type { ConfigValue } from '../config/registry';

// The account level (GDD §12.1; M5a): experience from every run that is not suspicious (per whole minute, per layer,
// per Core and for extracting), never cut by the daily yield. Levels come from cumulative thresholds.

export type AccountConfig = ConfigValue<'account'>;
export type RunOutcome = 'extracted' | 'died' | 'abandoned';

export interface RunProgressInput {
  seconds: number;
  depth: number;
  bossKills: number;
  outcome: RunOutcome;
}

export function runXp(run: RunProgressInput, cfg: AccountConfig): number {
  const minutes = Math.floor(Math.max(0, run.seconds) / 60);
  return (
    minutes * cfg.xp.perMinute +
    Math.max(0, Math.floor(run.depth)) * cfg.xp.perLayer +
    Math.max(0, Math.floor(run.bossKills)) * cfg.xp.perCore +
    (run.outcome === 'extracted' ? cfg.xp.extraction : 0)
  );
}

/** The level of `xp`, what it has into that level and what the next one asks for (null at the top). */
export function levelOf(xp: number, cfg: AccountConfig): { level: number; into: number; next: number | null } {
  const total = Math.max(0, Math.floor(xp));
  let reached = 0;
  while (reached < cfg.levels.length && total >= cfg.levels[reached]!) reached++;
  const floor = reached === 0 ? 0 : cfg.levels[reached - 1]!;
  const next = reached < cfg.levels.length ? cfg.levels[reached]! - floor : null;
  return { level: reached + 1, into: total - floor, next };
}
