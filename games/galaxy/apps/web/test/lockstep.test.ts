import { expect, test } from 'vitest';
import { createLockstep } from '../src/arena/lockstep';

// The co-op pacer (multiplayer plan, phase 6): only closed ticks are simulated, about 60 a second a few ticks behind
// the last closed one, faster when far behind (catching up within a frame budget), and never past what is closed.

function harness(opts: { buffer?: number; maxSteps?: number } = {}) {
  let t = 0;
  let cb: ((now: number) => void) | null = null;
  const state = { tick: 0, closed: 0, renders: 0 };
  const loop = createLockstep({
    step: () => {
      state.tick++;
    },
    render: () => {
      state.renders++;
    },
    current: () => state.tick,
    closed: () => state.closed,
    now: () => t,
    schedule: (f) => {
      cb = f;
    },
    ...opts,
  });
  const frames = (n: number, ms = 1000 / 60) => {
    for (let i = 0; i < n; i++) {
      t += ms;
      const f = cb;
      cb = null;
      f?.(t);
    }
  };
  return { loop, state, frames };
}

test('nunca simula más allá del último tick cerrado', () => {
  const h = harness();
  h.loop.start();
  h.state.closed = 5;
  h.frames(120);
  expect(h.state.tick).toBe(5);
  expect(h.state.renders).toBe(120);
});

test('con los ticks llegando a su ritmo, avanza unos 60 por segundo unos pocos por detrás', () => {
  const h = harness({ buffer: 3 });
  h.loop.start();
  for (let i = 0; i < 600; i++) {
    h.state.closed++;
    h.frames(1);
  }
  expect(h.state.tick).toBeGreaterThan(590);
  expect(h.state.closed - h.state.tick).toBeLessThanOrEqual(8);
  expect(h.state.closed - h.state.tick).toBeGreaterThanOrEqual(1);
});

test('muy por detrás (al volver o repetir el registro), se pone al día por tramos sin pasarse', () => {
  const h = harness({ buffer: 3, maxSteps: 50 });
  h.loop.start();
  h.state.closed = 1000;
  h.frames(1);
  expect(h.state.tick).toBeGreaterThan(1);
  expect(h.state.tick).toBeLessThanOrEqual(50);
  h.frames(40);
  expect(h.state.tick).toBeGreaterThanOrEqual(990);
  expect(h.state.tick).toBeLessThanOrEqual(1000);
});

test('parado, no avanza ni debe nada al seguir', () => {
  const h = harness();
  h.loop.start();
  h.loop.stop();
  h.state.closed = 50;
  h.frames(10);
  expect(h.state.tick).toBe(0);
});
