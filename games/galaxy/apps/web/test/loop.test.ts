import { expect, test } from 'vitest';
import { createLoop } from '../src/arena/loop';

// The fixed-step loop (GDD §18.4): 60 simulation steps per second whatever the display, at most 5 per frame, and
// nothing to catch up after a pause or a hidden tab (Review Focus 1).

function harness() {
  let t = 0;
  let steps = 0;
  const alphas: number[] = [];
  const queued: ((now: number) => void)[] = [];
  const loop = createLoop({
    step: () => steps++,
    render: (alpha) => alphas.push(alpha),
    now: () => t,
    schedule: (cb) => {
      queued.push(cb);
    },
  });
  /** Advances the clock by `ms` and runs one frame. */
  const frame = (ms: number) => {
    t += ms;
    const cb = queued.shift();
    cb?.(t);
  };
  return { loop, frame, steps: () => steps, alphas };
}

test('da 60 pasos por segundo con fotogramas de 60 Hz o de 144 Hz', () => {
  const a = harness();
  a.loop.start();
  for (let i = 0; i < 60; i++) a.frame(1000 / 60);
  expect(a.steps()).toBeGreaterThanOrEqual(59);
  expect(a.steps()).toBeLessThanOrEqual(60);
  const b = harness();
  b.loop.start();
  for (let i = 0; i < 144; i++) b.frame(1000 / 144);
  expect(b.steps()).toBeGreaterThanOrEqual(59);
  expect(b.steps()).toBeLessThanOrEqual(60);
  expect(Math.max(...b.alphas)).toBeLessThan(1);
});

test('nunca más de 5 pasos en un fotograma: un tirón no acelera la partida', () => {
  const h = harness();
  h.loop.start();
  h.frame(16);
  const before = h.steps();
  h.frame(500);
  expect(h.steps() - before).toBe(5);
  const after = h.steps();
  h.frame(1000 / 60);
  expect(h.steps() - after).toBeLessThanOrEqual(1);
});

test('en pausa no avanza y al volver no recupera el tiempo perdido', () => {
  const h = harness();
  h.loop.start();
  h.frame(16);
  h.loop.pause();
  expect(h.loop.paused).toBe(true);
  const before = h.steps();
  for (let i = 0; i < 10; i++) h.frame(1000);
  expect(h.steps()).toBe(before);
  h.loop.resume();
  h.frame(1000 / 60);
  expect(h.steps() - before).toBeLessThanOrEqual(1);
});

test('stop deja de pedir fotogramas', () => {
  const h = harness();
  h.loop.start();
  h.frame(16);
  h.loop.stop();
  const before = h.steps();
  h.frame(100);
  h.frame(100);
  expect(h.steps()).toBe(before);
});

test('una pausa antes de arrancar se respeta: la partida no corre detrás del menú', () => {
  const h = harness();
  h.loop.pause();
  h.loop.start();
  expect(h.loop.paused).toBe(true);
  h.frame(100);
  h.frame(100);
  expect(h.steps()).toBe(0);
  h.loop.resume();
  h.frame(1000 / 60);
  h.frame(1000 / 60);
  expect(h.steps()).toBeGreaterThan(0);
});

// Speed of the admin debug mode (2026-11-15): the same fixed step, more or fewer of them per second of the wall.
test('x2 da 2 pasos por fotograma de 60 Hz y x0,25 uno cada 4', () => {
  const h = harness();
  h.loop.start();
  h.loop.setSpeed(2);
  expect(h.loop.speed).toBe(2);
  h.frame(1000 / 60);
  for (let i = 0; i < 60; i++) h.frame(1000 / 60);
  expect(h.steps()).toBeGreaterThanOrEqual(119);
  expect(h.steps()).toBeLessThanOrEqual(122);
  const q = harness();
  q.loop.start();
  q.loop.setSpeed(0.25);
  for (let i = 0; i < 60; i++) q.frame(1000 / 60);
  expect(q.steps()).toBeGreaterThanOrEqual(14);
  expect(q.steps()).toBeLessThanOrEqual(15);
});

test('x8 da 8 pasos por fotograma de 60 Hz', () => {
  const h = harness();
  h.loop.start();
  h.loop.setSpeed(8);
  for (let i = 0; i < 60; i++) h.frame(1000 / 60);
  expect(h.steps()).toBeGreaterThanOrEqual(478);
  expect(h.steps()).toBeLessThanOrEqual(481);
});

test('x8 no arrastra deuda tras un tirón', () => {
  const h = harness();
  h.loop.start();
  h.loop.setSpeed(8);
  h.frame(1000 / 60);
  const before = h.steps();
  h.frame(1000);
  expect(h.steps() - before).toBe(40);
  const after = h.steps();
  h.frame(1000 / 60);
  expect(h.steps() - after).toBeLessThanOrEqual(9);
});

test('cambiar de velocidad no cobra lo que quedaba pendiente', () => {
  const h = harness();
  h.loop.start();
  h.frame(1000 / 120);
  h.loop.setSpeed(1);
  const before = h.steps();
  h.frame(1000 / 120);
  expect(h.steps() - before).toBe(0);
});

