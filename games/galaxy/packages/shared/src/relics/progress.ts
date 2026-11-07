import type { ConfigValue } from '../config/registry';
import type { ProbeCondition, RunStats } from '../probes/unlocks';

// Relic levels and slots (GDD §8.4, §8.4 bis; M4c-1). A galaxy levels 1–10 with star dust (`levels[i]` is the cost of
// reaching level i + 2) and returns `refund` of what was put into it when fused or disintegrated. The relic slots open
// one by one from the third: each asks for a milestone (the same run stats that unlock probes) and dust.

export type RelicsConfig = ConfigValue<'relics'>;

/** The dust of going from `level` to `level + 1`, or null at the top. */
export function relicLevelCost(level: number, cfg: RelicsConfig): number | null {
  const l = Math.max(1, Math.floor(level));
  return l < cfg.levels.length + 1 ? cfg.levels[l - 1]! : null;
}

/** What fusing or disintegrating returns of the dust put into its levels. */
export function relicRefund(invested: number, cfg: RelicsConfig): number {
  return Math.floor(Math.max(0, invested) * cfg.refund + 1e-9);
}

export interface NextSlot {
  /** The slot it opens (1-based: the third is 3). */
  slot: number;
  condition: ProbeCondition;
  /** 0–1 towards the milestone. */
  progress: number;
  dust: number;
  /** The milestone is met (the dust is checked when buying). */
  ready: boolean;
}

/** The next slot to open after `slots` open ones, or null when all six are. */
export function nextSlot(slots: number, stats: RunStats, cfg: RelicsConfig): NextSlot | null {
  const next = cfg.slots[slots - 2];
  if (!next) return null;
  const have = stats[next.condition.stat];
  const progress = Math.max(0, Math.min(1, have / next.condition.value));
  return { slot: slots + 1, condition: { ...next.condition }, progress, dust: next.dust, ready: have >= next.condition.value };
}
