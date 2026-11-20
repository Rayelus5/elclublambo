// The pro scanner's clock (plan «escáner pro», part B): the timeline's time, read from one real clock — the audio
// clock when it runs, so what is seen and what is heard never drift apart — and drawn once per frame by the player.
// It pauses (a hidden tab), holds at a moment (the single card's wait; a card whose image is still coming), seeks
// (Seguir, Saltar, the Ensayo's «ir a fase») and runs slower (the Ensayo). Hit-stops are holds written into the
// timeline, never rate changes, so script time and real time stay a straight line apart.

export interface StageClock {
  /** The script's time now (seconds). */
  now(): number;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  seek(t: number): void;
  /** Stops time at `t` until `holdAt(null)`; it carries on from there, never jumping. */
  holdAt(t: number | null): void;
  readonly held: number | null;
  setRate(rate: number): void;
  readonly rate: number;
  /** Real seconds until the script reaches `t` (Infinity while paused or held before it). */
  until(t: number): number;
}

/** Seconds on a smooth real clock: the audio context's output (when it runs), else the page's. */
export function audioTime(ctx: AudioContext | null, perf: () => number = () => performance.now()): number {
  if (ctx && ctx.state === 'running' && typeof ctx.getOutputTimestamp === 'function') {
    const ts = ctx.getOutputTimestamp();
    if (typeof ts.contextTime === 'number' && typeof ts.performanceTime === 'number' && ts.performanceTime > 0) {
      return ts.contextTime + (perf() - ts.performanceTime) / 1000;
    }
    return ctx.currentTime;
  }
  return perf() / 1000;
}

export function createClock(source: () => number, start = 0): StageClock {
  let base = start;
  let anchor = source();
  let paused = false;
  let held: number | null = null;
  let rate = 1;

  const raw = () => (paused ? base : base + (source() - anchor) * rate);
  const now = () => {
    const t = raw();
    return held !== null && t >= held ? held : t;
  };
  const reanchor = (t: number) => {
    base = t;
    anchor = source();
  };

  return {
    now,
    pause() {
      if (paused) return;
      reanchor(now());
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      anchor = source();
    },
    get paused() {
      return paused;
    },
    seek(t) {
      reanchor(t);
      if (held !== null && held < t) held = null;
    },
    holdAt(t) {
      if (t === null) {
        if (held !== null) reanchor(now());
        held = null;
        return;
      }
      reanchor(now());
      held = t;
    },
    get held() {
      return held;
    },
    setRate(r) {
      reanchor(now());
      rate = Math.max(0.05, r);
    },
    get rate() {
      return rate;
    },
    until(t) {
      const n = now();
      if (t <= n) return 0;
      if (paused || (held !== null && held < t)) return Infinity;
      return (t - n) / rate;
    },
  };
}
