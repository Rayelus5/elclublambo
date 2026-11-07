import { drawTraits, subRng } from '@galaxy/engine';
import { describe, expect, test } from 'vitest';
import { baseOf, botPick, type Content, createSim, DEFAULT_CONTENT, deriveStats, type Offer, refreshStats, type RelicInput, Rng, spawnEnemy, type StatBonus, step } from '../src/index';

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
 * rings never show it). 1.5× the strongest measured (2026-11-07: the lenticular extreme, 1 164 654 per second).
 */
const CROWD_DPS_CEILING = 1_750_000;

export interface Build {
  weapons: { id: string; level: number }[];
  passives: { id: string; level: number }[];
  relics: RelicInput[];
}

const base = DEFAULT_CONTENT.weapons.filter((w) => !w.evolution);
const evolutions = DEFAULT_CONTENT.weapons.filter((w) => w.evolution);
/** A weapon's root: an evolution's base, a variant's base (M4b-1), or itself — one weapon per root in a build. */
const rootOf = (id: string) => baseOf(DEFAULT_CONTENT, DEFAULT_CONTENT.weapons.find((d) => d.id === id)?.evolution?.from ?? id);

/**
 * Every build plays with a level-10 probe (M4b-1): the default bonuses of `probes.levels` in @galaxy/shared (its tests
 * pin that they are these), so the ceilings hold for the strongest probe the player can have.
 */
export const VETERAN: StatBonus[] = [
  { stat: 'maxHp', value: 0.27 },
  { stat: 'damage', value: 0.18 },
];

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

/** The strongest evolutions with every damage passive at its max and two Legendary galaxies of one type and palette. */
export function extremeBuilds(): Build[] {
  const top = ['pulse-storm', 'neutron-lance', 'orbital-lance', 'ion-ray', 'crystal-crown', 'missile-swarm'];
  const passives = ['amplifier', 'overcharge', 'scope', 'capacitor', 'splitter', 'catalyst'].map((id) => ({ id, level: DEFAULT_CONTENT.passives.find((p) => p.id === id)!.levels.length }));
  return ['spiral', 'barred_spiral', 'ring', 'irregular', 'lenticular', 'merger'].map((type, k) => ({
    weapons: top.map((id) => ({ id, level: 1 })),
    passives,
    relics: [0, 1].map((j) => ({
      id: `x${k}${j}`,
      seed: '9',
      tier: 4,
      level: 10,
      traits: { galaxy_type: type, arms: '6', size: 'colossal', core: 'quasar', star_density: 'saturated', palette: 'solar_gold', background: 'cmb', phenomenon: 'supernova', inclination: 'face_on' },
    })),
  }));
}

/** Damage per second of a build on the proving ground: rings of sturdy, still posts around a probe that never dies. */
export function proving(content: Content, build: Build, seconds: number): number {
  const c = structuredClone(content);
  const s = c.sectors[0]!;
  s.density = { ...s.density, base: 0, perMinute: 0, max: 0 };
  s.waves = [];
  s.layerSeconds = 100_000;
  c.enemies.push({ ...c.enemies[0]!, id: 'post', hp: 1e9, speed: 0, xp: 0 });
  const post = c.enemies[c.enemies.length - 1]!;
  const sim = createSim({ seed: '5', content: c, sector: s.id, probes: [{ probe: 'lumen', relics: build.relics, bonuses: VETERAN }] });
  const p = sim.probes[0]!;
  p.weapons = build.weapons.map((w) => ({ ...w, t: 0 }));
  p.passives = build.passives.map((x) => ({ ...x }));
  refreshStats(sim, p);
  for (let r = 1; r <= 4; r++) for (let k = 0; k < 8; k++) spawnEnemy(sim, post, Math.cos((k * Math.PI) / 4) * r * 45, Math.sin((k * Math.PI) / 4) * r * 45);
  p.hp = 1e12;
  let dealt = 0;
  for (let t = 0; t < seconds * 60; t++) {
    step(sim, [{ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer as Offer[]) : -1 }]);
    for (const e of sim.events) if (e.t === 'hit') dealt += e.amount;
  }
  return dealt / seconds;
}

/**
 * Damage per second against a dense crowd: a 9 × 9 block of sturdy posts 18 units apart in front of the probe. It
 * shows what the rings miss: lines and areas over many enemies, reactions and chains spreading through a crowd.
 */
export function crowd(content: Content, build: Build, seconds: number): number {
  const c = structuredClone(content);
  const s = c.sectors[0]!;
  s.density = { ...s.density, base: 0, perMinute: 0, max: 0 };
  s.waves = [];
  s.layerSeconds = 100_000;
  c.enemies.push({ ...c.enemies[0]!, id: 'post', hp: 1e9, speed: 0, xp: 0 });
  const post = c.enemies[c.enemies.length - 1]!;
  const sim = createSim({ seed: '5', content: c, sector: s.id, probes: [{ probe: 'lumen', relics: build.relics, bonuses: VETERAN }] });
  const p = sim.probes[0]!;
  p.weapons = build.weapons.map((w) => ({ ...w, t: 0 }));
  p.passives = build.passives.map((x) => ({ ...x }));
  refreshStats(sim, p);
  for (let gx = 0; gx < 9; gx++) for (let gy = 0; gy < 9; gy++) spawnEnemy(sim, post, 40 + gx * 18, (gy - 4) * 18);
  p.hp = 1e12;
  let dealt = 0;
  for (let t = 0; t < seconds * 60; t++) {
    step(sim, [{ mx: 0, my: 0, aim: 0, pick: p.offer ? botPick(p.offer as Offer[]) : -1 }]);
    for (const e of sim.events) if (e.t === 'hit') dealt += e.amount;
  }
  return dealt / seconds;
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
