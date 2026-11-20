import { expect, test } from 'vitest';
import { contentSchema, DEFAULT_CONTENT, hurtProbe } from '../src/index';
import { quietSim } from './fixtures';

// Enemy life plan (2026-11-15), the owner: enemy damage may grow little by little, «pero sin llegar a ser excesivo para
// evitar instant kill por parte de los enemigos en un solo ataque». No single hit (fauna, shots, Núcleos, blasts) takes
// more than `hitCap` of the probe's maximum life, after armour and shield; the hits that follow still add up.

test('ningún golpe se lleva más de `hitCap` de la vida máxima', () => {
  const sim = quietSim((c) => {
    c.hitCap = 0.35;
  });
  const p = sim.probes[0]!;
  hurtProbe(sim, p, 1e6);
  expect(p.alive).toBe(true);
  expect(p.hp).toBeCloseTo(p.stats.maxHp * 0.65, 9);
});

test('los golpes siguientes sí suman: tres seguidos, con su respiro entre ellos, pueden acabar con la sonda', () => {
  const sim = quietSim((c) => {
    c.hitCap = 0.35;
  });
  const p = sim.probes[0]!;
  for (let k = 0; k < 3; k++) {
    p.invulnT = 0;
    hurtProbe(sim, p, 1e6);
  }
  expect(p.alive).toBe(false);
});

test('un golpe por debajo del tope hace su daño de siempre', () => {
  const sim = quietSim((c) => {
    c.hitCap = 0.35;
  });
  const p = sim.probes[0]!;
  hurtProbe(sim, p, 10);
  expect(p.hp).toBe(p.stats.maxHp - 10);
});

test('un contenido publicado antes, sin `hitCap`, toma el del código', () => {
  const old = structuredClone(DEFAULT_CONTENT) as unknown as Record<string, unknown>;
  delete old['hitCap'];
  expect(contentSchema.parse(old).hitCap).toBe(DEFAULT_CONTENT.hitCap);
});

test('con `hitCap` 1 no hay tope: un golpe enorme mata', () => {
  const sim = quietSim();
  const p = sim.probes[0]!;
  hurtProbe(sim, p, 1e6);
  expect(p.alive).toBe(false);
});

// Review: the cap goes on the raw hit, so armour and shields still count against the biggest hits.
test('el tope va antes de la armadura y el escudo: siguen protegiendo de los golpes enormes', () => {
  const sim = quietSim((c) => {
    c.hitCap = 0.4;
  });
  const p = sim.probes[0]!;
  p.stats.armor = 0.5;
  p.shield = 10;
  hurtProbe(sim, p, 1e6);
  // 40 % of the maximum life, halved by the armour, and the shield takes 10 of it.
  expect(p.hp).toBeCloseTo(p.stats.maxHp - (p.stats.maxHp * 0.4 * 0.5 - 10), 9);
  expect(p.shield).toBe(0);
});
