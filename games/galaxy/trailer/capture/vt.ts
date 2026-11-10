import { page } from 'vitest/browser';

// Virtual time for capturing the game frame by frame (the trailer). Timers, animation frames, performance.now and
// Date.now follow a clock that only moves when we say so, and every CSS animation and transition is paused and set to
// that clock too. Each video frame: move the clock 1/60 s, let React commit, take a screenshot. However slow the
// software renderer is, the frames come out exactly 1/60 s apart.

type Timer = { at: number; cb: () => void; every: number };

export interface VirtualTime {
  readonly now: number;
  /** Moves the clock by `ms`: due timers in order, then one round of animation frames, then the CSS animations. */
  advance(ms: number): Promise<void>;
  /** Waits for React (and anything else on real macrotasks) to settle. */
  settle(): Promise<void>;
  /** A real (not virtual) wait. */
  sleep(ms: number): Promise<void>;
}

export function installVirtualTime(start = 1000): VirtualTime {
  const real = {
    setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window),
  };
  let now = start;
  let seq = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();
  const w = window as unknown as Record<string, unknown>;
  w.setTimeout = (cb: unknown, ms = 0, ...args: unknown[]) => {
    const id = seq++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), cb: () => typeof cb === 'function' && cb(...args), every: 0 });
    return id;
  };
  w.setInterval = (cb: unknown, ms = 0, ...args: unknown[]) => {
    const id = seq++;
    const every = Math.max(1, Number(ms) || 0);
    timers.set(id, { at: now + every, cb: () => typeof cb === 'function' && cb(...args), every });
    return id;
  };
  w.clearTimeout = (id: number) => void timers.delete(id);
  w.clearInterval = (id: number) => void timers.delete(id);
  w.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = seq++;
    frames.set(id, cb);
    return id;
  };
  w.cancelAnimationFrame = (id: number) => void frames.delete(id);
  performance.now = () => now;
  const epoch = Date.parse('2026-11-12T19:00:00.000Z');
  Date.now = () => epoch + now;

  // CSS animations and transitions: paused when first seen and set to the virtual clock from then on.
  const born = new WeakMap<Animation, number>();
  const syncCss = () => {
    for (const a of document.getAnimations()) {
      if (!born.has(a)) {
        born.set(a, now - (Number(a.currentTime) || 0));
        a.pause();
      }
      a.currentTime = (now - born.get(a)!) * (a.playbackRate || 1);
    }
  };

  const macrotask = () => new Promise<void>((r) => real.setTimeout(r, 0));
  return {
    get now() {
      return now;
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let next: [number, Timer] | null = null;
        for (const entry of timers) if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        const [id, t] = next;
        now = Math.max(now, t.at);
        if (t.every) t.at += t.every;
        else timers.delete(id);
        try {
          t.cb();
        } catch (e) {
          console.error(e);
        }
        await Promise.resolve();
      }
      now = target;
      const round = [...frames.values()];
      frames.clear();
      for (const cb of round) {
        try {
          cb(now);
        } catch (e) {
          console.error(e);
        }
      }
      syncCss();
    },
    async settle() {
      await macrotask();
      await macrotask();
      syncCss();
    },
    sleep: (ms) => new Promise<void>((r) => real.setTimeout(r, ms)),
  };
}

/** Takes `count` frames of 1/60 s each into frames/<name>/f00000.png, calling `each(frame)` before each one. */
export async function record(vt: VirtualTime, name: string, count: number, each?: (frame: number) => void | Promise<void>, skip = 0): Promise<void> {
  // Frames before `skip` play on the virtual clock without a picture, to record only the end of a long scene.
  for (let f = 0; f < count; f++) {
    if (each) await each(f);
    await vt.advance(1000 / 60);
    await vt.settle();
    if (f >= skip) await page.screenshot({ path: `frames/${name}/f${String(f - skip).padStart(5, '0')}.png` });
  }
}

/** Holds these keys down (and lets go of the others) as the player would. */
export function hold(codes: string[], held: Set<string>): void {
  for (const c of [...held]) {
    if (!codes.includes(c)) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: c, key: c }));
      held.delete(c);
    }
  }
  for (const c of codes) {
    if (!held.has(c)) {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: c, key: c }));
      held.add(c);
    }
  }
}

export function press(code: string, key = code): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, key }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, key }));
}
