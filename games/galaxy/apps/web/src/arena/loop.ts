// The fixed-step loop (GDD §18.4): the simulation steps at 60 Hz whatever the display's rate, the renderer draws in
// between with the leftover fraction (alpha). At most 5 steps per frame: after a hitch the rest is dropped, so the run
// slows down for a moment instead of fast-forwarding. Paused, nothing advances and nothing is owed on resume. The admin
// debug mode (2026-11-15) changes the speed: the same step, more or fewer per second of the wall, and the cap per frame
// grows with it so x8 is really x8 on a 60 Hz display.

const STEP = 1 / 60;
const MAX_STEPS = 5;

export interface Loop {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Steps per second of the wall, as a multiple of 60 (1 normal). Changing it drops what was owed. */
  setSpeed(speed: number): void;
  readonly speed: number;
}

export interface LoopDeps {
  step: () => void;
  render: (alpha: number) => void;
  now: () => number;
  schedule: (cb: (now: number) => void) => void;
}

export function createLoop(deps: LoopDeps): Loop {
  let running = false;
  let paused = false;
  let last = 0;
  let acc = 0;
  let speed = 1;

  function frame(t: number): void {
    if (!running) return;
    deps.schedule(frame);
    if (paused) {
      last = t;
      deps.render(acc / STEP);
      return;
    }
    acc += Math.max(0, (t - last) / 1000) * speed;
    last = t;
    let n = 0;
    const most = Math.ceil(MAX_STEPS * Math.max(1, speed));
    while (acc >= STEP && n < most) {
      deps.step();
      acc -= STEP;
      n++;
      if (!running) return;
    }
    if (acc >= STEP) acc = 0;
    deps.render(acc / STEP);
  }

  return {
    start() {
      if (running) return;
      running = true;
      // A pause asked for while the stage was loading stays: start never unpauses.
      acc = 0;
      last = deps.now();
      deps.schedule(frame);
    },
    stop() {
      running = false;
    },
    pause() {
      paused = true;
    },
    resume() {
      if (!paused) return;
      paused = false;
      last = deps.now();
    },
    get paused() {
      return paused;
    },
    setSpeed(s) {
      speed = s;
      acc = 0;
    },
    get speed() {
      return speed;
    },
  };
}
