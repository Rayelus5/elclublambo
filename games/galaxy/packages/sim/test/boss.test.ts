import { describe, expect, test } from 'vitest';
import { angleTo, dealDamage, IDLE, type Sim, step } from '../src/index';
import { quietSim } from './fixtures';

// The Static Core (GDD §5.5): phases that change with its life and patterns that are always announced first.

const src = { probe: 0, weapon: null, relic: null, element: null };

function withBoss(): Sim {
  const sim = quietSim((c) => {
    c.sectors[0]!.layerSeconds = 1;
  });
  sim.probes[0]!.hp = 1e9;
  sim.rng.combat.chance = () => false; // exact damage: no criticals
  for (let i = 0; i < 70 && !sim.boss; i++) step(sim, [IDLE]);
  return sim;
}
const bullets = (sim: Sim) => {
  const out: number[] = [];
  for (let i = 0; i < sim.foeShots.top; i++) if (sim.foeShots.alive[i]) out.push(i);
  return out;
};
/** Bullets by slot and generation: a slot freed and reused within one tick is still a new bullet. */
const bulletKeys = (sim: Sim) => new Set(bullets(sim).map((i) => i * 65536 + sim.foeShots.gen[i]!));

describe('fases', () => {
  test('cambian al bajar del 60 % y del 25 % de vida', () => {
    const sim = withBoss();
    const b = sim.boss!;
    dealDamage(sim, b.index, 1800 * 0.41, src);
    step(sim, [IDLE]);
    expect(sim.events).toContainEqual({ t: 'bossPhase', phase: 1 });
    expect(sim.boss!.phase).toBe(1);
    dealDamage(sim, b.index, 1800 * 0.37, src);
    step(sim, [IDLE]);
    expect(sim.boss!.phase).toBe(2);
  });
});

describe('patrones', () => {
  test('el primero (radial de 16) se anuncia 0,6 s antes y sale en 16 direcciones', () => {
    const sim = withBoss();
    let warned = -1;
    let fired = -1;
    for (let t = 0; t < 4 * 60 && fired < 0; t++) {
      step(sim, [IDLE]);
      if (warned < 0 && sim.events.some((e) => e.t === 'telegraph' && e.kind === 'burst')) warned = sim.tick;
      if (bullets(sim).length > 0) fired = sim.tick;
    }
    expect(warned).toBeGreaterThan(0);
    expect(fired - warned).toBe(36);
    const angles = bullets(sim)
      .map((i) => angleTo(sim.foeShots.vx[i]!, sim.foeShots.vy[i]!))
      .sort((a, b) => a - b);
    expect(angles).toHaveLength(16);
    for (let k = 1; k < 16; k++) expect(Math.abs(angles[k]! - angles[k - 1]! - 256)).toBeLessThanOrEqual(1);
  });

  test('en ciclo: radial, invocación de 6 ácaros y abanico apuntado de 5', () => {
    const sim = withBoss();
    const mite = sim.content.enemies.findIndex((e) => e.id === 'mite');
    const mites = () => {
      let n = 0;
      for (let i = 0; i < sim.enemies.top; i++) if (sim.enemies.alive[i] && !sim.enemies.boss[i] && sim.enemies.type[i] === mite) n++;
      return n;
    };
    // Three intervals of 2.6 s.
    let maxMites = 0;
    let aimed = false;
    for (let t = 0; t < 3 * 156 + 10; t++) {
      const before = new Set(bullets(sim));
      step(sim, [IDLE]);
      maxMites = Math.max(maxMites, mites());
      const fresh = bullets(sim).filter((i) => !before.has(i));
      if (fresh.length === 5) aimed = true;
    }
    expect(maxMites).toBe(6);
    expect(aimed).toBe(true);
  });

  test('la embestida de la fase 2 avisa y luego carga en línea recta', () => {
    const sim = withBoss();
    const b = sim.boss!;
    dealDamage(sim, b.index, 1800 * 0.41, src);
    let charge = false;
    for (let t = 0; t < 3 * 120 && !charge; t++) {
      step(sim, [IDLE]);
      charge = sim.events.some((e) => e.t === 'telegraph' && e.kind === 'charge');
    }
    expect(charge).toBe(true);
    const x0 = sim.enemies.x[b.index]!;
    const y0 = sim.enemies.y[b.index]!;
    for (let t = 0; t < 54 + 30; t++) step(sim, [IDLE]);
    const moved = Math.hypot(sim.enemies.x[b.index]! - x0, sim.enemies.y[b.index]! - y0);
    expect(moved).toBeGreaterThan(100);
  });

  test('la espiral de la fase 3 dispara una bala cada 0,08 s durante 2,5 s', () => {
    const sim = withBoss();
    const b = sim.boss!;
    dealDamage(sim, b.index, 1800 * 0.8, src);
    let started = -1;
    let shots = 0;
    for (let t = 0; t < 8 * 60; t++) {
      const before = bulletKeys(sim);
      step(sim, [IDLE]);
      const fresh = [...bulletKeys(sim)].filter((k) => !before.has(k)).length;
      if (fresh === 1) {
        if (started < 0) started = sim.tick;
        shots++;
      }
      if (started > 0 && sim.tick > started + 150) break;
    }
    expect(shots).toBeGreaterThanOrEqual(30);
    expect(shots).toBeLessThanOrEqual(33);
  });
});
