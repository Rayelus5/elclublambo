// The fixed-step loop (GDD §18.4): the simulation steps at 60 Hz whatever the display's rate, the renderer draws in
// between with the leftover fraction (alpha). At most 5 steps per frame: after a hitch the rest is dropped, so the run
// slows down for a moment instead of fast-forwarding. Paused, nothing advances and nothing is owed on resume.

const STEP = 1 / 60;
const MAX_STEPS = 5;

export interface Loop {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
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

  function frame(t: number): void {
    if (!running) return;
    deps.schedule(frame);
    if (paused) {
      last = t;
      deps.render(acc / STEP);
      return;
    }
    acc += Math.max(0, (t - last) / 1000);
    last = t;
    let n = 0;
    while (acc >= STEP && n < MAX_STEPS) {
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
      paused = false;
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
  };
}
