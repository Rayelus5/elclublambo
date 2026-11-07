import type { ConfigValue } from '../config/registry';

// Probe unlocks (GDD §6: «el resto de sondas se ganan jugando… nunca salen del gachapón»). The test gives one starter;
// the other two starters and the five others are earned with the stats of the account's finished, non-suspicious
// runs. The conditions are live config (`probes`).

export interface RunStats {
  /** Finished runs. */
  runs: number;
  bossKills: number;
  /** Deepest layer reached. */
  maxDepth: number;
  extractions: number;
  kills: number;
}

export type ProbesConfig = ConfigValue<'probes'>;
export type ProbeCondition = { stat: keyof RunStats; value: number };

export interface ProbeStatus {
  unlocked: boolean;
  /** What unlocks it (null: the test's probe, or a probe with no condition, which cannot be earned). */
  condition: ProbeCondition | null;
  /** 0–1 towards the condition. */
  progress: number;
}

export function probeStatus(probe: string, assigned: string, stats: RunStats, cfg: ProbesConfig): ProbeStatus {
  if (probe === assigned) return { unlocked: true, condition: null, progress: 1 };
  const condition: ProbeCondition | undefined = (cfg.starters as readonly string[]).includes(probe) ? cfg.starterUnlock : cfg.unlocks[probe];
  if (!condition) return { unlocked: false, condition: null, progress: 0 };
  const have = stats[condition.stat];
  return { unlocked: have >= condition.value, condition, progress: Math.max(0, Math.min(1, have / condition.value)) };
}
