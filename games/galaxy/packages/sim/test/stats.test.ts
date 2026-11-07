import { expect, test } from 'vitest';
import { applyOffer, deriveStats } from '../src/index';
import { quietSim } from './fixtures';

// Probe stats (GDD §8.6): every source adds to its category with diminishing returns and a cap per category, so no
// stack of passives and relics can break the game.

test('sin mejoras: los valores de la sonda, crítico base del 5 % y ×1,5', () => {
  const sim = quietSim();
  const s = deriveStats(sim, sim.probes[0]!);
  expect(s).toEqual({
    maxHp: 100,
    speed: 60,
    cooldown: 1,
    damage: 1,
    area: 1,
    pickup: 30,
    projectiles: 0,
    regen: 0,
    armor: 0,
    crit: 0.05,
    critDamage: 1.5,
    xp: 1,
    luck: 1,
    lifesteal: 0,
  });
});

test('las pasivas suben su categoría: Condensador 5 acorta un 30 % y Blindaje 1 da un 15 % más de vida', () => {
  const sim = quietSim();
  const p = sim.probes[0]!;
  p.passives.push({ id: 'capacitor', level: 5 });
  expect(deriveStats(sim, p).cooldown).toBeCloseTo(0.7, 12);
  applyOffer(sim, p, { kind: 'passive', id: 'armor', level: 1 });
  expect(p.stats.maxHp).toBeCloseTo(115, 9);
  expect(p.hp).toBeCloseTo(115, 9);
});

test('el enfriamiento nunca baja del 40 % por mucho que se acumule', () => {
  const sim = quietSim((c) => {
    c.probes[0]!.bonus = { cooldown: 0.55 };
  });
  const p = sim.probes[0]!;
  p.passives.push({ id: 'capacitor', level: 5 });
  const s = deriveStats(sim, p);
  expect(s.cooldown).toBeGreaterThan(0.4);
  expect(s.cooldown).toBeLessThan(0.5);
});

test('los proyectiles extra se recortan en +6 y la regeneración en 5 por segundo', () => {
  const sim = quietSim((c) => {
    c.probes[0]!.bonus = { projectiles: 10, regen: 9 };
  });
  const s = deriveStats(sim, sim.probes[0]!);
  expect(s.projectiles).toBe(6);
  expect(s.regen).toBe(5);
});

test('la sonda inicial real recoge desde más lejos y aprende un 10 % más rápido', () => {
  const sim = quietSim((c) => {
    c.probes[0]!.bonus = { pickup: 0.3, xp: 0.1 };
  });
  const s = deriveStats(sim, sim.probes[0]!);
  expect(s.pickup).toBeCloseTo(30 * (1 + 3 * (1 - (1 - 0.3 / 3))), 9);
  expect(s.xp).toBeCloseTo(1 + 1 * (1 - (1 - 0.1)), 9);
});
