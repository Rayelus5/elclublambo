import { drawTraits, subRng } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { baseOf, createSim, DEFAULT_CONTENT, deriveStats, Rng } from '../src/index';
import { type Build, crowd, proving, VETERAN } from './proving';

// The build simulation of GDD §8.6: before each version, thousands of random builds plus the extreme ones are played
// on a proving ground; none may pass the damage ceiling or break a cap. The brakes stop a build from breaking the
// game, not a Legendary from shining. The short run is part of every CI; GALAXY_CALIBRATE=1 runs the long one.

const LONG = process.env['GALAXY_CALIBRATE'] === '1';

/**
 * The most damage per second a build may deal on the proving ground (plan Task 8): 1.5× the strongest build measured
 * (2026-11-07, after tuning Rayo de iones: a random build with it and two lenticulars, 113 918 per second; the designed
 * extremes reach 88 457). A regression that makes any build stronger than that fails the CI.
 */
const BUILD_DPS_CEILING = 175_000;
/** Random builds spread at most this much above their median (measured: 9×). */
const RANDOM_SPREAD = 12;
/**
 * The same against a dense crowd (M3b-1 final review: lines, areas, chains and reactions scale with crowds, and the
 * rings never show it). 1.5× the strongest measured. Re-measured for M4c-1, when the six relic slots opened: the
 * lenticular extreme with six Legendary galaxies of level 10, a level-10 probe and the whole Laboratorio deals
 * 1 923 192 per second in a crowd (its crit and crit damage stay within their caps; the same family stacks with
 * diminishing magnitude from the third relic, §8.6). With two slots the same build dealt 1 509 878.
 */
const CROWD_DPS_CEILING = 2_900_000;

const base = DEFAULT_CONTENT.weapons.filter((w) => !w.evolution);
const evolutions = DEFAULT_CONTENT.weapons.filter((w) => w.evolution);
/** A weapon's root: an evolution's base, a variant's base (M4b-1), or itself — one weapon per root in a build. */
const rootOf = (id: string) => baseOf(DEFAULT_CONTENT, DEFAULT_CONTENT.weapons.find((d) => d.id === id)?.evolution?.from ?? id);

/** Random builds from a seeded stream: 1–6 weapons (a quarter of them evolved), 0–6 passives, 2 random relics. */
export function randomBuild(k: number): Build {
  const rng = Rng.fromSeed(`${20261107 + k}`, 'build');
  const pick = <T,>(list: readonly T[]) => list[rng.int(list.length)]!;
  const weapons: Build['weapons'] = [];
  const nw = 1 + rng.int(6);
  while (weapons.length < nw) {
    const evo = rng.chance(0.25);
    const def = evo ? pick(evolutions) : pick(base);
    if (weapons.some((w) => rootOf(w.id) === rootOf(def.id))) continue;
    weapons.push({ id: def.id, level: evo ? 1 : 1 + rng.int(def.levels.length) });
  }
  const passives: Build['passives'] = [];
  const np = rng.int(7);
  while (passives.length < np) {
    const def = pick(DEFAULT_CONTENT.passives);
    if (passives.some((s) => s.id === def.id)) continue;
    passives.push({ id: def.id, level: 1 + rng.int(def.levels.length) });
  }
  const relics = [0, 1].map((j) => {
    const seed = BigInt(k * 131 + j * 17 + 5);
    return { id: `${k}-${j}`, seed: seed.toString(), tier: Number(seed % 5n), level: 1 + Number(seed % 10n), traits: drawTraits(subRng(seed, 'traits')) as unknown as Record<string, string> };
  });
  return { weapons, passives, relics };
}

/**
 * The strongest evolutions with every damage passive at its max and six Legendary galaxies of level 10 (every slot open,
 * M4c-1) of one type and palette.
 */
export function extremeBuilds(): Build[] {
  const top = ['pulse-storm', 'neutron-lance', 'orbital-lance', 'ion-ray', 'crystal-crown', 'missile-swarm'];
  const passives = ['amplifier', 'overcharge', 'scope', 'capacitor', 'splitter', 'catalyst'].map((id) => ({ id, level: DEFAULT_CONTENT.passives.find((p) => p.id === id)!.levels.length }));
  return ['spiral', 'barred_spiral', 'ring', 'irregular', 'lenticular', 'merger'].map((type, k) => ({
    weapons: top.map((id) => ({ id, level: 1 })),
    passives,
    relics: [0, 1, 2, 3, 4, 5].map((j) => ({
      id: `x${k}${j}`,
      seed: '9',
      tier: 4,
      level: 10,
      traits: { galaxy_type: type, arms: '6', size: 'colossal', core: 'quasar', star_density: 'saturated', palette: 'solar_gold', background: 'cmb', phenomenon: 'supernova', inclination: 'face_on' },
    })),
  }));
}

function capsHold(build: Build): void {
  const sim = createSim({ seed: '1', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: build.relics, bonuses: VETERAN }] });
  const p = sim.probes[0]!;
  p.passives = build.passives.map((x) => ({ ...x }));
  const s = deriveStats(sim, p);
  const caps = DEFAULT_CONTENT.caps;
  expect(s.cooldown).toBeGreaterThanOrEqual(1 - caps.cooldown);
  expect(s.projectiles).toBeLessThanOrEqual(caps.projectiles);
  expect(s.pierce).toBeLessThanOrEqual(caps.pierce);
  expect(s.armor).toBeLessThanOrEqual(caps.armor);
  expect(s.barrier).toBeLessThanOrEqual(caps.barrier);
  expect(s.curse).toBeLessThanOrEqual(caps.curse);
  expect(s.elemental).toBeLessThanOrEqual(1 + caps.elemental);
  expect(s.velocity).toBeLessThanOrEqual(1 + caps.velocity);
}

describe('simulación de combinaciones (CI)', () => {
  test('40 combinaciones al azar y 6 extremas: ninguna pasa del techo, las al azar no pasan de 12× su mediana, y nadie rompe un tope', () => {
    const random = Array.from({ length: 40 }, (_, k) => randomBuild(k));
    const extremes = extremeBuilds();
    const dps = random.map((b) => proving(DEFAULT_CONTENT, b, 60));
    const top = extremes.map((b) => proving(DEFAULT_CONTENT, b, 60));
    const median = [...dps].sort((a, b) => a - b)[Math.floor(dps.length / 2)]!;
    for (const d of dps) expect(d).toBeLessThanOrEqual(RANDOM_SPREAD * median);
    for (const d of [...dps, ...top]) expect(d).toBeLessThanOrEqual(BUILD_DPS_CEILING);
    for (const b of [...random, ...extremes]) capsHold(b);
  }, 300_000);
});

describe('combinaciones en una multitud (CI)', () => {
  test('40 al azar y 6 extremas contra una multitud: ninguna pasa del techo y las al azar no pasan de 12× su mediana', () => {
    const dps = Array.from({ length: 40 }, (_, k) => crowd(DEFAULT_CONTENT, randomBuild(k), 30));
    const top = extremeBuilds().map((b) => crowd(DEFAULT_CONTENT, b, 30));
    const median = [...dps].sort((a, b) => a - b)[Math.floor(dps.length / 2)]!;
    for (const d of dps) expect(d).toBeLessThanOrEqual(RANDOM_SPREAD * median);
    for (const d of [...dps, ...top]) expect(d).toBeLessThanOrEqual(CROWD_DPS_CEILING);
  }, 300_000);
});

describe('evoluciones en una multitud (CI)', () => {
  test('ninguna evolución, sola, rinde menos que su arma base al máximo', () => {
    const C = DEFAULT_CONTENT;
    for (const evo of C.weapons.filter((w) => w.evolution)) {
      const base = C.weapons.find((w) => w.id === evo.evolution!.from)!;
      const b = crowd(C, { weapons: [{ id: base.id, level: base.levels.length }], passives: [], relics: [] }, 20);
      // Weapons that need the probe to move (trails) deal nothing on a still ground: nothing to compare.
      if (b === 0) continue;
      const e = crowd(C, { weapons: [{ id: evo.id, level: 1 }], passives: [], relics: [] }, 20);
      expect(e, `${evo.id} frente a ${base.id}`).toBeGreaterThanOrEqual(b);
    }
  }, 300_000);
});

describe.skipIf(!LONG)('simulación de combinaciones larga (GALAXY_CALIBRATE=1)', () => {
  test('500 combinaciones al azar durante 60 s tampoco pasan del techo', () => {
    const dps = Array.from({ length: 500 }, (_, k) => proving(DEFAULT_CONTENT, randomBuild(k + 1000), 60));
    const sorted = [...dps].sort((a, b) => a - b);
    console.log(`combinaciones: mediana ${sorted[250]!.toFixed(0)}, p95 ${sorted[475]!.toFixed(0)}, máx ${sorted[499]!.toFixed(0)}`);
    for (const d of dps) expect(d).toBeLessThanOrEqual(BUILD_DPS_CEILING);
  }, 1_200_000);
});
