import type { StationConfig } from './rooms';

// The refinery (GDD §10.3; M4a plan ruling 4): it turns queued raw material into components, one for one, at its
// level's rate per hour, in server time. It advances lazily (on every read or write) and keeps the time of a partial
// unit, so splitting an hour never loses anything. An empty queue lets its clock follow the hour: idle hours never
// count for a later load.

export interface RefineryRow {
  /** Material waiting to be refined. */
  queue: number;
  /** Components refined, waiting to be collected. */
  ready: number;
  /** The time the queue has been refined up to. */
  clock: Date;
}

const HOUR = 3_600_000;

export function refineryLevel(level: number, cfg: StationConfig): { rate: number; queue: number } {
  const l = cfg.refinery[Math.max(1, Math.min(level, cfg.refinery.length)) - 1]!;
  return { rate: l.rate, queue: l.queue };
}

export function advanceRefinery(row: RefineryRow, level: number, cfg: StationConfig, now: Date): RefineryRow {
  const elapsed = now.getTime() - row.clock.getTime();
  if (elapsed <= 0) return row;
  if (row.queue <= 0) return { queue: 0, ready: row.ready, clock: now };
  const { rate } = refineryLevel(level, cfg);
  const processed = Math.min(row.queue, Math.floor((rate * elapsed) / HOUR + 1e-9));
  const queue = row.queue - processed;
  // Done: nothing left to carry. Otherwise the clock moves by the time those units took, keeping the fraction.
  const clock = queue === 0 ? now : new Date(row.clock.getTime() + Math.round((processed * HOUR) / rate));
  return { queue, ready: row.ready + processed, clock };
}

/** When the next unit will be ready (null with an empty queue). */
export function nextRefined(row: RefineryRow, level: number, cfg: StationConfig): Date | null {
  if (row.queue <= 0) return null;
  return new Date(row.clock.getTime() + Math.ceil(HOUR / refineryLevel(level, cfg).rate));
}
