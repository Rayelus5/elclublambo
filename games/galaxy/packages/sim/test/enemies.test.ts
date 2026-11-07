import { describe, expect, test } from 'vitest';
import { angleTo, dealDamage, degToSteps, spawnEnemy, step, type Sim, IDLE } from '../src/index';
import { quietSim, run } from './fixtures';

// Fauna of the Static (GDD §5.5): each family asks for a different answer — swarms that chase, chargers that warn
// before a straight dash, shooters that keep their distance, armour that only gives from behind, splitters, and
// elites with Static modifiers.

const def = (sim: Sim, id: string) => sim.content.enemies.find((e) => e.id === id)!;
const elite = (sim: Sim, id: string) => sim.content.elites.find((e) => e.id === id)!;
const src = { probe: 0, weapon: null, relic: null, element: null };
const alive = (sim: Sim, id: string) => {
  let n = 0;
  const t = sim.content.enemies.findIndex((e) => e.id === id);
  for (let i = 0; i < sim.enemies.top; i++) if (sim.enemies.alive[i] && sim.enemies.type[i] === t) n++;
  return n;
};
const dist = (sim: Sim, e: number) => Math.hypot(sim.enemies.x[e]! - sim.probes[0]!.x, sim.enemies.y[e]! - sim.probes[0]!.y);

describe('comportamientos', () => {
  test('chase se acerca a la sonda y se separa de sus vecinos', () => {
    const sim = quietSim();
    const a = spawnEnemy(sim, def(sim, 'mite'), 300, 0);
    const b = spawnEnemy(sim, def(sim, 'mite'), 300, 0.5);
    run(sim, 60);
    expect(dist(sim, a)).toBeLessThan(300 - 40);
    const gap = Math.hypot(sim.enemies.x[a]! - sim.enemies.x[b]!, sim.enemies.y[a]! - sim.enemies.y[b]!);
    expect(gap).toBeGreaterThan(8);
  });

  test('charge avisa, espera quieta, embiste en línea recta y luego descansa', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, def(sim, 'ray'), 100, 0);
    let warned = -1;
    for (let t = 0; t < 120 && warned < 0; t++) {
      step(sim, [IDLE]);
      if (sim.events.some((ev) => ev.t === 'telegraph' && ev.kind === 'charge')) warned = sim.tick;
    }
    expect(warned).toBeGreaterThan(0);
    const x0 = sim.enemies.x[e]!;
    run(sim, 41);
    expect(sim.enemies.x[e]).toBeCloseTo(x0, 6);
    run(sim, 2);
    const xs: number[] = [];
    for (let t = 0; t < 20; t++) {
      step(sim, [IDLE]);
      xs.push(sim.enemies.x[e]!);
    }
    const speeds = xs.slice(1).map((x, i) => Math.abs(x - xs[i]!) * 60);
    expect(Math.min(...speeds)).toBeGreaterThan(200);
    // After the dash: 3 s before the next warning.
    let next = false;
    for (let t = 0; t < 150; t++) {
      step(sim, [IDLE]);
      if (sim.events.some((ev) => ev.t === 'telegraph')) next = true;
    }
    expect(next).toBe(false);
  });

  test('shooter se queda a su distancia y dispara su abanico de 3 balas a 20°', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, def(sim, 'spitter'), 400, 0);
    // The first volley: the bullets that appear in one tick.
    let fresh: number[] = [];
    for (let t = 0; t < 60 * 12 && fresh.length === 0; t++) {
      const before = new Set<number>();
      for (let i = 0; i < sim.foeShots.top; i++) if (sim.foeShots.alive[i]) before.add(i);
      step(sim, [IDLE]);
      for (let i = 0; i < sim.foeShots.top; i++) if (sim.foeShots.alive[i] && !before.has(i)) fresh.push(i);
    }
    expect(dist(sim, e)).toBeLessThan(150 + 2);
    expect(fresh).toHaveLength(3);
    const fs = sim.foeShots;
    const angles = fresh.map((i) => angleTo(fs.vx[i]!, fs.vy[i]!)).sort((a, b) => a - b);
    expect(Math.abs(angles[1]! - angles[0]! - degToSteps(20))).toBeLessThanOrEqual(2);
    expect(Math.abs(angles[2]! - angles[1]! - degToSteps(20))).toBeLessThanOrEqual(2);
    expect(Math.hypot(fs.vx[fresh[0]!]!, fs.vy[fresh[0]!]!) * 60).toBeCloseTo(120, 6);
    fresh = [];
    run(sim, 60 * 8);
    expect(dist(sim, e)).toBeGreaterThan(110);
    expect(dist(sim, e)).toBeLessThan(190);
  });

  test('las balas enemigas hieren a la sonda y desaparecen', () => {
    const sim = quietSim();
    spawnEnemy(sim, def(sim, 'spitter'), 140, 0);
    let hurt = false;
    for (let t = 0; t < 60 * 6 && !hurt; t++) {
      step(sim, [IDLE]);
      hurt = sim.events.some((ev) => ev.t === 'hurt');
    }
    expect(hurt).toBe(true);
  });

  test('armored recibe un 75 % menos por delante y el daño completo por la espalda', () => {
    const sim = quietSim();
    sim.rng.combat.chance = () => false;
    const e = spawnEnemy(sim, def(sim, 'shell'), 100, 0);
    // It faces the probe (at the origin): a hit coming from the probe's side is frontal.
    dealDamage(sim, e, 20, { ...src, x: 0, y: 0 });
    expect(sim.enemies.hp[e]).toBeCloseTo(70 - 5, 9);
    dealDamage(sim, e, 20, { ...src, x: 200, y: 0 });
    expect(sim.enemies.hp[e]).toBeCloseTo(70 - 5 - 20, 9);
  });

  test('armored gira despacio hacia la sonda', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, def(sim, 'shell'), 200, 0);
    sim.enemies.facing[e] = 0; // looking away (+x)
    step(sim, [IDLE]);
    const turned = sim.enemies.facing[e]!;
    // 90°/s → 1.5°/tick ≈ 17 steps.
    expect(Math.min(turned, 4096 - turned)).toBeLessThanOrEqual(18);
    expect(Math.min(turned, 4096 - turned)).toBeGreaterThan(0);
  });

  test('una célula partida deja 2 crías al morir', () => {
    const sim = quietSim();
    dealDamage(sim, spawnEnemy(sim, def(sim, 'cell'), 300, 0), 1000, src);
    expect(alive(sim, 'cellet')).toBe(2);
  });

  test('un enemigo que se aleja más de 1 100 u vuelve al borde de la vista', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, def(sim, 'mite'), 2000, 0);
    step(sim, [IDLE]);
    const d = dist(sim, e);
    expect(d).toBeLessThan(1100);
    expect(d).toBeGreaterThan(400 / 2);
  });
});

describe('élites', () => {
  test('Blindada: su escudo del 60 % se gasta antes que la vida', () => {
    const sim = quietSim();
    sim.rng.combat.chance = () => false;
    const e = spawnEnemy(sim, def(sim, 'mite'), 300, 0, { elite: elite(sim, 'shielded') });
    expect(sim.enemies.hp[e]).toBe(32);
    expect(sim.enemies.shield[e]).toBeCloseTo(19.2, 9);
    dealDamage(sim, e, 10, src);
    expect(sim.enemies.hp[e]).toBe(32);
    expect(sim.enemies.shield[e]).toBeCloseTo(9.2, 9);
  });

  test('Veloz: corre un 45 % más', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, def(sim, 'mite'), 300, 0, { elite: elite(sim, 'swift') });
    expect(sim.enemies.speed[e]).toBeCloseTo(62 * 1.45, 9);
  });

  test('Inestable: al morir avisa y a los 0,6 s explota dañando a la sonda en su radio', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, def(sim, 'mite'), 30, 0, { elite: elite(sim, 'volatile') });
    sim.enemies.speed[e] = 0;
    dealDamage(sim, e, 1000, src);
    expect(sim.events.some((ev) => ev.t === 'telegraph' && ev.kind === 'explode')).toBe(true);
    run(sim, 35);
    expect(sim.probes[0]!.hp).toBe(100);
    run(sim, 2);
    expect(sim.probes[0]!.hp).toBe(100 - 18);
    expect(sim.enemies.alive[e]).toBe(0);
  });
});
