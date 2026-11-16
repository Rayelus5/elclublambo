import { expect, test } from 'vitest';
import { contentSchema, DEFAULT_CONTENT, IDLE, type Sim, spawnEnemy, step, swarmWeight } from '../src/index';
import { quietSim } from './fixtures';

// Fewer small enemies piling up (the owner, 2026-11-16: «se me siguen acumulando exageradas cantidades de enemigos
// pequeños y me cuesta matar a los núcleos»): the swarm family stops coming while too many of it are alive, comes less
// as the run goes on (the others take its place), and during the Núcleo a quarter of the usual comes, not half.

const SWARM = (sim: Sim) => {
  const en = sim.enemies;
  let n = 0;
  for (let e = 0; e < en.top; e++) if (en.alive[e] && !en.boss[e] && sim.content.enemies[en.type[e]!]!.family === 'swarm') n++;
  return n;
};

/** A world where the director spawns fast: a swarm species and a tougher one, both open from the start. */
function crowded(cap: number) {
  return quietSim((c) => {
    const s = c.sectors[0]!;
    s.density = { ...s.density, base: 20, perMinute: 0, max: 20, cap: 500 };
    s.spawns = [
      { enemy: 'mite', from: 0, weight: 1, group: [3, 3] },
      { enemy: 'shell', from: 0, weight: 1, group: [1, 1] },
    ];
    s.swarm = { cap, fadeFrom: 0, fadePerMinute: 0, fadeFloor: 1 };
    for (const e of c.enemies) if (e.id === 'mite' || e.id === 'shell') e.speed = 0;
  });
}

test('con muchos del enjambre vivos, sus grupos dejan de salir y salen los demás', () => {
  const sim = crowded(12);
  const mite = sim.content.enemies.find((e) => e.id === 'mite')!;
  for (let k = 0; k < 12; k++) spawnEnemy(sim, mite, 300 + k * 10, 300);
  const before = SWARM(sim);
  for (let i = 0; i < 300; i++) step(sim, [IDLE]);
  expect(SWARM(sim)).toBe(before);
  expect(sim.enemies.count - SWARM(sim)).toBeGreaterThan(10);
});

test('por debajo del tope el enjambre sale como siempre, y nunca pasa de un grupo por encima', () => {
  const sim = crowded(12);
  for (let i = 0; i < 600; i++) step(sim, [IDLE]);
  expect(SWARM(sim)).toBeGreaterThan(0);
  expect(SWARM(sim)).toBeLessThanOrEqual(12 + 3);
});

test('sin tope (0) el enjambre se acumula como antes', () => {
  const sim = crowded(0);
  for (let i = 0; i < 600; i++) step(sim, [IDLE]);
  expect(SWARM(sim)).toBeGreaterThan(30);
});

test('a partir de su minuto el enjambre sale cada vez menos, hasta su mínimo', () => {
  const sim = quietSim((c) => {
    c.sectors[0]!.swarm = { cap: 0, fadeFrom: 8, fadePerMinute: 0.1, fadeFloor: 0.3 };
  });
  const at = (minutes: number) => {
    sim.tick = Math.round(minutes * 3600);
    return swarmWeight(sim);
  };
  expect(at(0)).toBe(1);
  expect(at(8)).toBe(1);
  expect(at(12)).toBeCloseTo(0.6, 5);
  expect(at(40)).toBe(0.3);
});

test('el contenido por defecto trae el enjambre a raya, un cuarto de aparición contra el Núcleo y un Amplificador que dobla el daño', () => {
  for (const s of DEFAULT_CONTENT.sectors) {
    expect(s.swarm.cap, s.id).toBeGreaterThan(0);
    expect(s.density.bossFactor, s.id).toBe(0.25);
  }
  expect(DEFAULT_CONTENT.passives.find((p) => p.id === 'amplifier')!.levels).toEqual([0.1, 0.2, 0.35, 0.6, 1]);
});

test('un contenido publicado antes, sin `swarm`, toma los valores por defecto', () => {
  const old = structuredClone(DEFAULT_CONTENT) as unknown as { sectors: Record<string, unknown>[] };
  for (const s of old.sectors) delete s.swarm;
  const parsed = contentSchema.parse(old);
  expect(parsed.sectors[0]!.swarm).toEqual(DEFAULT_CONTENT.sectors[0]!.swarm);
});
