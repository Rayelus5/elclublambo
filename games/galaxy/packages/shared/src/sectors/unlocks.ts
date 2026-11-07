import type { ConfigValue } from '../config/registry';

// Sector unlocks (GDD §5.5, §13.1; M3b-3 plan rulings 4–5). A normal sector with no condition is open (the Nebulosa);
// the others open with the account's stats in the sector their condition names (finished, non-suspicious runs). A
// season sector is open to everyone while it is the live config's `season`, and closed (with no condition) otherwise.

export interface SectorStats {
  bossKills: number;
  /** Deepest layer reached. */
  maxDepth: number;
  extractions: number;
}

export type SectorsConfig = ConfigValue<'sectors'>;
export type SectorCondition = { sector: string; stat: keyof SectorStats; value: number };

export interface SectorStatus {
  unlocked: boolean;
  /** What opens it (null: open from the start, or a season sector). */
  condition: SectorCondition | null;
  /** 0–1 towards the condition. */
  progress: number;
  season: boolean;
}

export function sectorStatus(def: { id: string; season: boolean }, stats: Readonly<Record<string, SectorStats>>, cfg: SectorsConfig): SectorStatus {
  if (def.season) {
    const open = cfg.season === def.id;
    return { unlocked: open, condition: null, progress: open ? 1 : 0, season: true };
  }
  const condition = cfg.unlocks[def.id];
  if (!condition) return { unlocked: true, condition: null, progress: 1, season: false };
  const have = stats[condition.sector]?.[condition.stat] ?? 0;
  return { unlocked: have >= condition.value, condition, progress: Math.max(0, Math.min(1, have / condition.value)), season: false };
}
