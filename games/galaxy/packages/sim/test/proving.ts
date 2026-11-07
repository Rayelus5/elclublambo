import { botPick, type Content, createSim, type Offer, refreshStats, type RelicInput, spawnEnemy, type StatBonus, step } from '../src/index';

// The proving grounds of GDD §8.6 (builds.test.ts, variants.test.ts): a probe that never dies deals damage to sturdy,
// still posts, in rings around it or as a dense crowd in front of it.

export interface Build {
  weapons: { id: string; level: number }[];
  passives: { id: string; level: number }[];
  relics: RelicInput[];
}

/**
 * Every build plays with a level-10 probe (M4b-1) and the whole Laboratorio (M4b-2): the default bonuses of
 * `probes.levels` and `lab` in @galaxy/shared (its tests pin that they are these), so the ceilings hold for the
 * strongest probe the player can have.
 */
export const VETERAN: StatBonus[] = [
  // Probe level 10 plus the whole Laboratorio (M4b-2): @galaxy/shared's lab tests pin that these are the totals.
  { stat: 'maxHp', value: 0.37 },
  { stat: 'damage', value: 0.28 },
  { stat: 'speed', value: 0.05 },
  { stat: 'cooldown', value: 0.05 },
  { stat: 'elemental', value: 0.15 },
  { stat: 'luck', value: 0.15 },
  { stat: 'pickup', value: 0.2 },
  { stat: 'xp', value: 0.1 },
];

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

