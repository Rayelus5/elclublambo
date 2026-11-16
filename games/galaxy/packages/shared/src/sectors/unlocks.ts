import type { ConfigValue } from '../config/registry';

// Sector unlocks (GDD §5.5, §13.1; M3b-3 plan rulings 4–5). A normal sector with no condition is open (the Nebulosa);
// the others open with the account's stats in the sector their condition names (finished, non-suspicious runs). A
// season sector is open while it is the live config's `season` and the account has played `seasonUnlock` runs in any
// sector (2026-11-16; whoever already finished a run in it keeps it), and closed (with no condition) otherwise.

export interface SectorStats {
  bossKills: number;
  /** Deepest layer reached. */
  maxDepth: number;
  extractions: number;
}

export type SectorsConfig = ConfigValue<'sectors'>;
/** `sector` null: counted in every sector (the season sector's runs, 2026-11-16). */
export type SectorCondition = { sector: string; stat: keyof SectorStats; value: number } | { sector: null; stat: 'runs'; value: number };

/** The account's totals over every sector: runs that count (finished, not suspicious, at least `minRunSeconds`). */
export interface AccountTotals {
  runs: number;
}

/** What a run in `sector` pays, × (2026-11-16); a sector the config does not list pays ×1. */
export function sectorPay(cfg: SectorsConfig, sector: string): number {
  return cfg.pay[sector] ?? 1;
}

export interface SectorStatus {
  unlocked: boolean;
  /** What opens it (null: open from the start, or a season sector). */
  condition: SectorCondition | null;
  /** 0–1 towards the condition. */
  progress: number;
  season: boolean;
}

export function sectorStatus(def: { id: string; season: boolean }, stats: Readonly<Record<string, SectorStats>>, cfg: SectorsConfig, totals: AccountTotals = { runs: 0 }): SectorStatus {
  if (def.season) {
    if (cfg.season !== def.id) return { unlocked: false, condition: null, progress: 0, season: true };
    const gate = cfg.seasonUnlock;
    // Whoever already finished a run in it keeps it (the gate came mid-season).
    if (!gate || (stats[def.id]?.maxDepth ?? 0) > 0 || totals.runs >= gate.value) return { unlocked: true, condition: null, progress: 1, season: true };
    return { unlocked: false, condition: { sector: null, stat: 'runs', value: gate.value }, progress: Math.max(0, Math.min(1, totals.runs / gate.value)), season: true };
  }
  const condition = cfg.unlocks[def.id];
  if (!condition) return { unlocked: true, condition: null, progress: 1, season: false };
  const have = stats[condition.sector]?.[condition.stat] ?? 0;
  return { unlocked: have >= condition.value, condition, progress: Math.max(0, Math.min(1, have / condition.value)), season: false };
}
