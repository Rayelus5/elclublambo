import { describe, expect, test } from 'vitest';
import { dealDamage, IDLE, PICKUP, type Sim, spawnEnemy, step } from '../src/index';
import { dropPickup } from '../src/systems/pickups';
import { quietSim, run } from './fixtures';

// Healing (Sifón rework, 2026-11-16). Life stolen from enemies (Sifón's lifesteal, the leech element, the drain
// reaction) heals only from the damage really dealt (never the overkill) and shares one budget a second, a share of the
// maximum life: Sifón raises it (level 1 ≈ 1,4 %/s, level 5 = 3 %/s), without it 1 %/s. Standing still under the
// Static blocks every heal (stillness.test.ts).

const TUNED = { base: 0.01, perLifesteal: 0.4, burst: 1 };
const dummy = (sim: Sim) => sim.content.enemies.find((e) => e.id === 'dummy')!;
const src = { probe: 0, weapon: null, relic: null, element: null } as const;

function world(lifesteal: number, healing = TUNED): Sim {
  const sim = quietSim((c) => {
    c.healing = healing;
  });
  run(sim, 1);
  const p = sim.probes[0]!;
  p.stats.lifesteal = lifesteal;
  p.stats.maxHp = 100;
  // No experience from the targets: their kills would open the cards, and the world (and the budget) waits for them.
  p.stats.xp = 0;
  // A second for the budget to fill.
  run(sim, 60);
  return sim;
}

/** A fresh 10-life target next to the probe. */
const target = (sim: Sim) => spawnEnemy(sim, dummy(sim), 30, 0);

describe('robo de vida', () => {
  test('cura solo del daño real: un golpe enorme a un enemigo de 10 de vida cura como uno de 10', () => {
    const sim = world(0.05, { base: 1000, perLifesteal: 0, burst: 1 });
    const p = sim.probes[0]!;
    p.hp = 50;
    dealDamage(sim, target(sim), 1000, src);
    expect(p.hp).toBeCloseTo(50 + 10 * 0.05, 9);
  });

  test('como mucho cura su tope por segundo, y el tope se rellena con el tiempo', () => {
    const sim = world(0.05);
    const p = sim.probes[0]!;
    // Sifón level 5: 3 % of 100 a second.
    p.hp = 10;
    for (let k = 0; k < 40; k++) dealDamage(sim, target(sim), 1000, src);
    expect(p.hp).toBeCloseTo(13, 6);
    run(sim, 60);
    for (let k = 0; k < 40; k++) dealDamage(sim, target(sim), 1000, src);
    expect(p.hp).toBeCloseTo(16, 6);
  });

  test('el Sifón a nivel 1 deja curar menos por segundo que a nivel 5', () => {
    const low = world(0.01);
    const high = world(0.05);
    for (const sim of [low, high]) {
      sim.probes[0]!.hp = 10;
      for (let k = 0; k < 40; k++) dealDamage(sim, target(sim), 1000, src);
    }
    expect(low.probes[0]!.hp).toBeCloseTo(11.4, 6);
    expect(high.probes[0]!.hp).toBeCloseTo(13, 6);
  });

  test('sin Sifón, la Sanguijuela cura como mucho un 1 % por segundo', () => {
    const sim = world(0);
    const p = sim.probes[0]!;
    p.hp = 10;
    for (let k = 0; k < 40; k++) dealDamage(sim, target(sim), 1000, { ...src, element: 'leech' });
    expect(p.hp).toBeGreaterThan(10);
    expect(p.hp).toBeCloseTo(11, 6);
  });

  test('el Sifón y la Sanguijuela comparten el mismo tope', () => {
    const sim = world(0.05);
    const p = sim.probes[0]!;
    p.hp = 10;
    for (let k = 0; k < 40; k++) dealDamage(sim, target(sim), 1000, { ...src, element: 'leech' });
    expect(p.hp).toBeCloseTo(13, 6);
  });

  test('a vida llena no gasta el tope', () => {
    const sim = world(0.05);
    const p = sim.probes[0]!;
    p.hp = 100;
    for (let k = 0; k < 10; k++) dealDamage(sim, target(sim), 1000, src);
    p.hp = 10;
    for (let k = 0; k < 40; k++) dealDamage(sim, target(sim), 1000, src);
    expect(p.hp).toBeCloseTo(13, 6);
  });
});

describe('curación bloqueada por la Estática', () => {
  /** Under the Static for good (it hurts nothing here: only the block is looked at). */
  const blocked = (sim: Sim) => {
    Object.assign(sim.content.stillness, { warn: 8, hurt: 12, damage: 0, growth: 0 });
    sim.probes[0]!.still.t = 60 * 12;
  };

  test('ni el robo de vida ni la regeneración curan', () => {
    const sim = world(0.05);
    const p = sim.probes[0]!;
    p.stats.regen = 5;
    p.hp = 10;
    blocked(sim);
    dealDamage(sim, target(sim), 1000, src);
    step(sim, [IDLE]);
    expect(p.hp).toBe(10);
  });

  test('los botiquines se quedan en el suelo', () => {
    const sim = world(0.05);
    const p = sim.probes[0]!;
    p.hp = 10;
    blocked(sim);
    dropPickup(sim, PICKUP.repair, 1, p.x, p.y);
    const before = sim.pickups.count;
    // The probe does not move: still blocked on the next steps.
    for (let k = 0; k < 5; k++) step(sim, [IDLE]);
    expect(sim.pickups.count).toBe(before);
    expect(p.hp).toBe(10);
  });
});
