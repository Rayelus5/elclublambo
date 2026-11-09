// The co-op pacer (multiplayer plan, phase 6). The server closes ticks at 60 Hz; a client simulates only closed
// ticks, a few behind the last one (the buffer that absorbs the network's jitter). It steps once per 1/60 s of real
// time, a little faster when it is falling behind and a little slower when it runs out of margin (±8 %), so it
// drifts back to the buffer instead of stuttering. Far behind (a hiccup, a hidden tab, rejoining and replaying the
// log) it catches up with many steps per frame, at most `maxSteps`. It never steps past the last closed tick, and
// the buffer grows when it runs dry and shrinks slowly while ticks keep arriving early.

const STEP = 1 / 60;
const NUDGE = 0.08;
const MIN_BUFFER = 2;
const MAX_BUFFER = 8;
const CATCH_UP_AT = 12;
/** Frames between two growths of the buffer, and the window its slack is measured over to shrink it. */
const GROW_EVERY = 30;
const SHRINK_WINDOW = 300;

export interface Lockstep {
  start(): void;
  stop(): void;
  /** Ticks closed but not yet simulated (the HUD shows «catching up» while this is large). */
  behind(): number;
}

export interface LockstepDeps {
  step: () => void;
  render: (alpha: number) => void;
  /** The simulation's tick now. */
  current: () => number;
  /** The last tick the server closed. */
  closed: () => number;
  now: () => number;
  schedule: (cb: (now: number) => void) => void;
  /** Ticks to stay behind at first (it adapts between 2 and 8). */
  buffer?: number;
  /** Most steps in one frame while catching up. */
  maxSteps?: number;
}

export function createLockstep(deps: LockstepDeps): Lockstep {
  let running = false;
  let last = 0;
  let acc = 0;
  let buffer = deps.buffer ?? 3;
  let frames = 0;
  let grewAt = -GROW_EVERY;
  let slack = Infinity;
  let window = 0;
  const maxSteps = deps.maxSteps ?? 240;

  function frame(t: number): void {
    if (!running) return;
    deps.schedule(frame);
    const dt = Math.max(0, Math.min(0.25, (t - last) / 1000));
    last = t;
    frames++;
    let ahead = deps.closed() - deps.current();
    if (ahead > buffer + CATCH_UP_AT) {
      // Far behind: catch up to the buffer at once, within the frame's budget.
      let n = 0;
      while (ahead > buffer && n < maxSteps && running) {
        deps.step();
        ahead--;
        n++;
      }
      acc = 0;
    } else {
      const rate = ahead > buffer + 2 ? 1 + NUDGE : ahead < buffer ? 1 - NUDGE : 1;
      acc += dt * rate;
      let n = 0;
      while (acc >= STEP && n < 5 && running) {
        if (ahead <= 0) {
          // Ran dry: wait for the server, and keep a bigger margin from now on (not before the run started, and at
          // most once in a while, so one hiccup does not set it at the top).
          if (deps.closed() > 0 && frames - grewAt >= GROW_EVERY) {
            buffer = Math.min(MAX_BUFFER, buffer + 1);
            grewAt = frames;
          }
          acc = Math.min(acc, STEP);
          break;
        }
        deps.step();
        ahead--;
        acc -= STEP;
        n++;
      }
      // The margin shrinks when, over a few seconds, there were always ticks to spare.
      if (deps.closed() > 0) {
        slack = Math.min(slack, ahead);
        if (++window >= SHRINK_WINDOW) {
          if (slack >= 2 && buffer > MIN_BUFFER) buffer--;
          slack = Infinity;
          window = 0;
        }
      }
    }
    deps.render(Math.min(1, acc / STEP));
  }

  return {
    start() {
      if (running) return;
      running = true;
      acc = 0;
      last = deps.now();
      deps.schedule(frame);
    },
    stop() {
      running = false;
    },
    behind() {
      return deps.closed() - deps.current();
    },
  };
}
