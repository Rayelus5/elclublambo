import { describe, expect, test } from 'vitest';
import { DEFAULT_CONTENT, hitArea, layerSeconds, PICKUP, type Sim, satelliteSignalsUpTo, worldSchedule } from '../src/index';
import { quietSim, run } from './fixtures';

// World events (plan «banda sonora, skins, perfil y entorno», part E; SIM 1.10.0): the abandoned satellites. The
// schedule comes from the seed alone (the server reads the same one); a satellite drifts by for its time, breaks under
// the probes' weapons and drops a signal that counts as the layer's loot, or drifts away.

const T = DEFAULT_CONTENT.satellites;

/** A seed whose run has at least `n` satellites. */
function seedWith(n: number): string {
  for (let k = 1; k < 100_000; k++) if (worldSchedule(String(k), T).length >= n) return String(k);
  throw new Error('no seed');
}

const withSatellites = (seed: string) =>
  quietSim(
    (c) => {
      c.satellites = { ...T };
    },
    { seed },
  );

/** Steps until the first satellite is out (or the time is up). */
function untilSatellite(sim: Sim, limit = 300 * 60): void {
  for (let k = 0; k < limit && sim.world.satellites.length === 0; k++) run(sim, 1);
}

describe('el calendario', () => {
  test('la misma semilla da siempre el mismo; cada satélite, en su capa y dentro de sus oleadas', () => {
    for (let k = 0; k < 200; k++) {
      const plan = worldSchedule(String(k), T);
      expect(worldSchedule(String(k), T)).toEqual(plan);
      plan.forEach((e, i) => {
        expect(e.layer).toBe(i + 1);
        expect(e.at).toBeGreaterThanOrEqual(T.earliest);
        expect(e.at).toBeLessThanOrEqual(T.latest);
      });
    }
  });

  test('en 10 000 partidas: uno en una de cada tres, dos en un 12 %, tres en un 4 %, y nunca más de tres', () => {
    const at = [0, 0, 0];
    for (let k = 0; k < 10_000; k++) {
      const n = worldSchedule(String(1_000_000 + k), T).length;
      expect(n).toBeLessThanOrEqual(3);
      for (let i = 0; i < n; i++) at[i]!++;
    }
    expect(at[0]! / 10_000).toBeCloseTo(0.33, 1);
    expect(Math.abs(at[1]! / 10_000 - 0.12)).toBeLessThan(0.015);
    expect(Math.abs(at[2]! / 10_000 - 0.04)).toBeLessThan(0.01);
  });

  test('el tope del servidor: solo los satélites de la semilla hasta la capa a la que llegó, y si le dio tiempo', () => {
    const seed = seedWith(2);
    const long = (depth: number) => ({ depth, ticks: depth * 300 * 60, layerSeconds: 300 });
    expect(satelliteSignalsUpTo(seed, T, long(1))).toBe(1);
    expect(satelliteSignalsUpTo(seed, T, long(9))).toBe(worldSchedule(seed, T).length);
    // A run that ended before its satellite's time never had it (the review: a script finishing at once).
    const first = worldSchedule(seed, T)[0]!;
    expect(satelliteSignalsUpTo(seed, T, { depth: 1, ticks: Math.floor(first.at * 60) - 1, layerSeconds: 300 })).toBe(0);
    expect(satelliteSignalsUpTo(seed, T, { depth: 1, ticks: Math.ceil(first.at * 60), layerSeconds: 300 })).toBe(1);
    // The second one comes in layer 2: never before a whole first layer and its own time.
    const second = worldSchedule(seed, T)[1]!;
    expect(satelliteSignalsUpTo(seed, T, { depth: 2, ticks: Math.floor((300 + second.at) * 60) - 1, layerSeconds: 300 })).toBe(1);
    const none = (() => {
      for (let k = 1; ; k++) if (worldSchedule(String(k), T).length === 0) return String(k);
    })();
    expect(satelliteSignalsUpTo(none, T, { depth: 9, ticks: 9 * 300 * 60, layerSeconds: 300 })).toBe(0);
  });
});

describe('un satélite', () => {
  test('llega a su hora, a la deriva, y roto suelta una señal que cuenta en el botín de la capa', () => {
    const seed = seedWith(1);
    const sim = withSatellites(seed);
    untilSatellite(sim);
    expect(sim.world.satellites).toHaveLength(1);
    expect(layerSeconds(sim)).toBeGreaterThanOrEqual(worldSchedule(seed, T)[0]!.at);
    const s = sim.world.satellites[0]!;
    const from = { x: s.x, y: s.y };
    run(sim, 30);
    expect(Math.hypot(s.x - from.x, s.y - from.y)).toBeGreaterThan(5);
    // A blast on it breaks it: it leaves a signal on the ground.
    hitArea(sim, s.x, s.y, 4, 10_000, { probe: 0, weapon: null, relic: null, element: null });
    expect(sim.world.satellites).toHaveLength(0);
    let signal = -1;
    for (let i = 0; i < sim.pickups.top; i++) if (sim.pickups.alive[i] && sim.pickups.kind[i] === PICKUP.signal) signal = i;
    expect(signal).toBeGreaterThanOrEqual(0);
    // Brought to the probe, it is picked up as the layer's signal.
    sim.pickups.x[signal] = sim.probes[0]!.x;
    sim.pickups.y[signal] = sim.probes[0]!.y;
    run(sim, 2);
    expect(sim.loot[0]!.signals).toBe(1);
  });

  test('si nadie lo rompe, se aleja a los 45 s', () => {
    const sim = withSatellites(seedWith(1));
    untilSatellite(sim);
    expect(sim.world.satellites).toHaveLength(1);
    run(sim, T.drift * 60 - 2);
    expect(sim.world.satellites).toHaveLength(1);
    run(sim, 3);
    expect(sim.world.satellites).toHaveLength(0);
    expect(sim.loot[0]!.signals).toBe(0);
  });

  test('sin satélites en el contenido no llega ninguno', () => {
    const sim = quietSim(undefined, { seed: seedWith(1) });
    run(sim, 250 * 60);
    expect(sim.world.satellites).toHaveLength(0);
  });
});
