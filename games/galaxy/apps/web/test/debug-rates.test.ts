import type { SimEvent } from '@galaxy/sim';
import { expect, test } from 'vitest';
import { createRates } from '../src/arena/debug/rates';

// The debug panel's live figures (2026-11-15): damage per second over the last 5 s of the run, frames per second and
// the real speed (run seconds per wall second).

const hit = (amount: number): SimEvent => ({ t: 'hit', x: 0, y: 0, amount, crit: false, element: null });

test('el DPS suma los golpes de los últimos 5 s de partida', () => {
  const r = createRates();
  for (let tick = 1; tick <= 600; tick++) r.onEvents([hit(10)], tick);
  // 60 hits a second of 10 each.
  expect(r.read(0, 600).dps).toBeCloseTo(600);
  // Nothing hits for 5 s: back to 0.
  expect(r.read(0, 900).dps).toBe(0);
});

test('al empezar divide por el tiempo jugado, no por 5 s', () => {
  const r = createRates();
  for (let tick = 1; tick <= 60; tick++) r.onEvents([hit(5)], tick);
  expect(r.read(0, 60).dps).toBeCloseTo(300);
});

test('FPS y velocidad real con el reloj de la pared', () => {
  const r = createRates();
  r.read(0, 0);
  for (let i = 1; i <= 30; i++) r.onFrame(i * (1000 / 30));
  // A second of wall in which the run moved 120 ticks: x2.
  const out = r.read(1000, 120);
  expect(out.fps).toBe(30);
  expect(out.speed).toBeCloseTo(2);
});

test('lo que guarda no crece con la partida: solo los últimos 5 s', () => {
  const r = createRates();
  for (let tick = 1; tick <= 100_000; tick++) r.onEvents([hit(1), hit(1)], tick);
  expect(r.size()).toBeLessThanOrEqual(300);
  expect(r.read(0, 100_000).dps).toBeCloseTo(120);
});

