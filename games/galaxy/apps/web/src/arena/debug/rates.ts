import type { SimEvent } from '@galaxy/sim';

// The admin debug panel's live figures (2026-11-15): damage per second over the last 5 s of the run (its own ticks,
// so a faster speed does not inflate it), frames per second and the real speed (run seconds per wall second, which
// shows when a slow machine cannot keep x8).

const WINDOW_TICKS = 300;
const WALL_MS = 1000;

export interface RateReading {
  dps: number;
  fps: number;
  /** Run seconds per wall second over the last second (1 at normal speed). */
  speed: number;
}

export interface Rates {
  onEvents(events: readonly SimEvent[], tick: number): void;
  onFrame(now: number): void;
  read(now: number, tick: number): RateReading;
}

export function createRates(): Rates {
  const hits: { tick: number; amount: number }[] = [];
  const frames: number[] = [];
  const samples: { now: number; tick: number }[] = [];
  return {
    onEvents(events, tick) {
      for (const e of events) if (e.t === 'hit') hits.push({ tick, amount: e.amount });
    },
    onFrame(now) {
      frames.push(now);
      while (frames.length > 0 && frames[0]! <= now - WALL_MS) frames.shift();
    },
    read(now, tick) {
      while (hits.length > 0 && hits[0]!.tick <= tick - WINDOW_TICKS) hits.shift();
      const span = Math.min(WINDOW_TICKS, Math.max(1, tick)) / 60;
      const dps = hits.reduce((a, h) => a + h.amount, 0) / span;
      while (frames.length > 0 && frames[0]! <= now - WALL_MS) frames.shift();
      samples.push({ now, tick });
      while (samples.length > 1 && samples[0]!.now < now - WALL_MS) samples.shift();
      const first = samples[0]!;
      const wall = (now - first.now) / 1000;
      const speed = wall > 0 ? (tick - first.tick) / 60 / wall : 0;
      return { dps, fps: frames.length, speed };
    },
  };
}
