import { expect, test } from 'vitest';
import { type Content, dealDamage, IDLE, type Sim, spawnEnemy, step } from '../src/index';
import { quietSim, run } from './fixtures';

// Enemies held by the harpoon or the sling (Nov plan B3, review fixes): a body in flight never hurts the players,
// pushes do not pile up while it is held, a harpoon always lets go, and the tow harpoon brings its catches to you.
const pin = (c: Content, id: string, row: Partial<Content['weapons'][number]['levels'][number]>) => Object.assign(c.weapons.find((w) => w.id === id)!.levels[0]!, row);
function armed(weapon: string, over?: (c: Content) => void): Sim {
  const sim = quietSim((c) => {
    c.enemies.find((e) => e.id === 'dummy')!.hp = 100;
    c.enemies.find((e) => e.id === 'dummy')!.xp = 0;
    over?.(c);
  });
  sim.rng.combat.chance = () => false;
  sim.probes[0]!.weapons = [{ id: weapon, level: 1, t: 0 }];
  return sim;
}
const target = (sim: Sim, x: number, y: number) => spawnEnemy(sim, sim.content.enemies.find((e) => e.id === 'dummy')!, x, y);

test('un cuerpo lanzado por la honda que pasa por encima de la sonda no la hiere', () => {
  const sim = armed('sling', (c) => pin(c, 'sling', { damage: 30, cooldown: 100, count: 1, speed: 360, range: 150, area: 30 }));
  target(sim, 22, 0);
  for (const [x, y] of [
    [-120, 0],
    [-126, 8],
    [-128, -8],
  ] as const)
    target(sim, x, y);
  const hp0 = sim.probes[0]!.hp;
  run(sim, 40);
  expect(sim.probes[0]!.hp).toBe(hp0);
});

test('los empujones no se acumulan en un enemigo arponeado: al soltarlo no sale disparado', () => {
  const sim = armed('harpoon', (c) => pin(c, 'harpoon', { damage: 1, cooldown: 100, speed: 480, range: 200, knockback: 120 }));
  const prey = target(sim, 150, 0);
  sim.probes[0]!.stats.knockback = 1;
  run(sim, 24);
  for (let t = 0; t < 70; t++) {
    if (sim.enemies.flashT[prey] === 0 && sim.enemies.held[prey]) dealDamage(sim, prey, 1, { probe: 0, weapon: null, relic: null, element: null, x: sim.enemies.x[prey]! + 10, y: sim.enemies.y[prey]! });
    step(sim, [IDLE]);
  }
  expect(sim.enemies.held[prey]).toBe(0);
  const at = [sim.enemies.x[prey]!, sim.enemies.y[prey]!];
  run(sim, 40);
  expect(Math.hypot(sim.enemies.x[prey]! - at[0]!, sim.enemies.y[prey]! - at[1]!)).toBeLessThan(8);
});

test('un arpón con recogida 0 (un valor del panel) acaba soltando a su presa', () => {
  const sim = armed('harpoon', (c) => pin(c, 'harpoon', { damage: 1, cooldown: 100, speed: 480, range: 200, knockback: 0 }));
  const prey = target(sim, 150, 0);
  run(sim, 60 * 10);
  expect(sim.enemies.held[prey]).toBe(0);
});

test('el arpón de remolque trae sus presas hasta la sonda aunque se mueva', () => {
  const sim = armed('tow-harpoon', (c) => pin(c, 'tow-harpoon', { count: 3, range: 260, cooldown: 100 }));
  const row = [40, 70, 100, 130, 160, 190].map((x) => target(sim, x, 0));
  for (let t = 0; t < 200; t++) step(sim, [t < 40 ? { ...IDLE, mx: 0, my: -127 } : IDLE]);
  const p = sim.probes[0]!;
  for (const e of row.slice(0, 3)) expect(Math.hypot(sim.enemies.x[e]! - p.x, sim.enemies.y[e]! - p.y)).toBeLessThan(70);
});
