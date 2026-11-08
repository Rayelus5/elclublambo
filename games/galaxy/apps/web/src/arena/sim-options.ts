import type { RunStart } from '@galaxy/shared';
import type { SimOptions } from '@galaxy/sim';

/**
 * The simulation of a run the server started: its seed, content and sector, and the probe with what the server
 * snapshotted for it (relics, its level's bonuses and its starting weapon, M4b-1), recorded for the replay.
 */
export function simOptions(run: RunStart): SimOptions {
  return {
    seed: run.seed,
    content: run.content,
    sector: run.sector,
    probes: [{ probe: run.probe, relics: run.relics, bonuses: run.bonuses, variant: run.variant }],
    anomaly: run.anomaly ?? null,
    record: true,
  };
}
