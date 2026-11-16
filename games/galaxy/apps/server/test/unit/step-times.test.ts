import { expect, test } from 'vitest';
import { benchReferee } from '../../src/coop/bench';
import { createStepTimes } from '../../src/coop/step-times';
import { runCli } from '../../src/cli';

// How much the co-op referee costs (pending minor, 2026-11-16): ms per simulation step, its percentiles, and a bench
// with the 400-enemy pool full that can be run on the homelab (CLI `bench-referee`).

test('los tiempos por paso dan media, p50, p99 y máximo de los últimos pasos', () => {
  const t = createStepTimes(100);
  for (let i = 1; i <= 100; i++) t.record(i / 10);
  const s = t.summary();
  expect(s.steps).toBe(100);
  expect(s.p50).toBeCloseTo(5, 5);
  expect(s.p99).toBeCloseTo(9.9, 5);
  expect(s.max).toBeCloseTo(10, 5);
  expect(s.mean).toBeCloseTo(5.05, 5);
  // A real second of play is 60 steps: how much of a core it takes.
  expect(s.coreShare).toBeCloseTo((5.05 * 60) / 1000, 5);
});

test('solo guarda los últimos pasos', () => {
  const t = createStepTimes(10);
  for (let i = 0; i < 50; i++) t.record(i < 40 ? 100 : 1);
  expect(t.summary().max).toBe(1);
  expect(t.summary().steps).toBe(50);
});

test('el banco del árbitro llena la piscina de enemigos de un grupo de cuatro y mide cada paso', () => {
  const r = benchReferee({ ticks: 900, players: 4 });
  expect(r.players).toBe(4);
  expect(r.maxAlive).toBeGreaterThanOrEqual(300);
  expect(r.times.steps).toBe(900);
  expect(r.times.p99).toBeGreaterThan(0);
});

test('la orden bench-referee de la CLI lo ejecuta y dice cuánto cuesta, sin tocar la base de datos', async () => {
  const lines: string[] = [];
  const code = await runCli(['bench-referee', '--ticks', '120', '--players', '2'], { db: undefined as never, env: undefined as never, out: (s) => lines.push(s) });
  expect(code).toBe(0);
  const out = lines.join(' ');
  expect(out).toContain('2 sondas');
  expect(out).toMatch(/p99 \d/);
  expect(await runCli(['bench-referee', '--ticks', 'muchos'], { db: undefined as never, env: undefined as never, out: () => {} })).toBe(1);
});

