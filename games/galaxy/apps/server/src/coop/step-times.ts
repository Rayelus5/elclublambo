// What the co-op referee costs (2026-11-16): the time of each simulation step, kept for the last `keep` steps, and its
// summary — mean, p50, p99, max — plus the share of one CPU core a real second of play takes (60 steps a second).

export interface StepSummary {
  /** Every step recorded, even those no longer kept. */
  steps: number;
  mean: number;
  p50: number;
  p99: number;
  max: number;
  /** Mean × 60 / 1000: the share of a core one run of this size keeps busy. */
  coreShare: number;
}

export interface StepTimes {
  record(ms: number): void;
  summary(): StepSummary;
}

/** Nearest rank: the smallest kept time with at least `q` of them at or below it. */
function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
}

export function createStepTimes(keep = 3600): StepTimes {
  const ring = new Float64Array(keep);
  let steps = 0;
  return {
    record(ms) {
      ring[steps % keep] = ms;
      steps++;
    },
    summary() {
      const n = Math.min(steps, keep);
      const kept = Array.from(ring.subarray(0, n)).sort((a, b) => a - b);
      const mean = n > 0 ? kept.reduce((a, b) => a + b, 0) / n : 0;
      return { steps, mean, p50: percentile(kept, 0.5), p99: percentile(kept, 0.99), max: kept[n - 1] ?? 0, coreShare: (mean * 60) / 1000 };
    },
  };
}
