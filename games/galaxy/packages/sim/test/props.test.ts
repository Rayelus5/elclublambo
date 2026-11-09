import { describe, expect, test } from 'vitest';
import { dropPickup, hitArea, PICKUP, PROP_CHUNK, propsAt, type Sim } from '../src/index';
import { move, quietSim, run } from './fixtures';

// Breakable props and the magnet (SIM 1.7.0): props live around the probes, break under their weapons, drop
// components and dust and stay broken; a magnet pulls every data fragment on the ground to whoever took it.

const withProps = (sim?: Partial<Parameters<typeof quietSim>[1]>) =>
  quietSim((c) => {
    c.props = { perChunk: 3, hp: 20, hpPerLayer: 0, radius: 9, componentChance: 1, components: 2, dustMin: 1, dustMax: 1 };
  }, sim);

function liveProps(sim: Sim): number[] {
  const out: number[] = [];
  for (let i = 0; i < sim.props.top; i++) if (sim.props.alive[i]) out.push(i);
  return out;
}

describe('objetos rompibles', () => {
  test('cada trozo tiene siempre los mismos objetos, dentro del trozo', () => {
    const a = propsAt('777', 3, -2, 3);
    expect(propsAt('777', 3, -2, 3)).toEqual(a);
    for (const p of a) {
      expect(p.x).toBeGreaterThanOrEqual(3 * PROP_CHUNK);
      expect(p.x).toBeLessThan(4 * PROP_CHUNK);
      expect(p.y).toBeGreaterThanOrEqual(-2 * PROP_CHUNK);
      expect(p.y).toBeLessThan(-1 * PROP_CHUNK);
      expect([0, 1, 2]).toContain(p.look);
    }
  });

  test('aparecen alrededor de la sonda en el primer tick', () => {
    const sim = withProps();
    run(sim, 1);
    expect(liveProps(sim).length).toBeGreaterThan(0);
    expect(sim.terrain.live.length).toBeGreaterThan(0);
  });

  test('un golpe de área los rompe y sueltan componentes y polvo', () => {
    const sim = withProps();
    run(sim, 1);
    const i = liveProps(sim)[0]!;
    const x = sim.props.x[i]!;
    const y = sim.props.y[i]!;
    hitArea(sim, x, y, 4, 50, { probe: 0, weapon: null, relic: null, element: null });
    expect(sim.props.alive[i]).toBe(0);
    expect(sim.events.some((e) => e.t === 'propBreak')).toBe(true);
    const kinds: number[] = [];
    for (let k = 0; k < sim.pickups.top; k++) if (sim.pickups.alive[k]) kinds.push(sim.pickups.kind[k]!);
    expect(kinds).toContain(PICKUP.component);
    expect(kinds).toContain(PICKUP.dust);
  });

  test('un objeto roto sigue roto al volver a su trozo', () => {
    const sim = withProps();
    run(sim, 1);
    const i = liveProps(sim)[0]!;
    const at = { x: sim.props.x[i]!, y: sim.props.y[i]! };
    hitArea(sim, at.x, at.y, 4, 50, { probe: 0, weapon: null, relic: null, element: null });
    // Far away (the chunk is released), then back.
    sim.probes[0]!.x += PROP_CHUNK * 12;
    run(sim, 10);
    sim.probes[0]!.x -= PROP_CHUNK * 12;
    run(sim, 10);
    const again = liveProps(sim).some((k) => sim.props.x[k] === at.x && sim.props.y[k] === at.y);
    expect(again).toBe(false);
    expect(liveProps(sim).length).toBeGreaterThan(0);
  });

  test('recoger un componente lo suma al botín de la capa', () => {
    const sim = withProps();
    dropPickup(sim, PICKUP.component, 2, 0, 0);
    run(sim, 2);
    expect(sim.loot[0]!.components).toBe(2);
  });

  test('las mismas entradas dan los mismos objetos y el mismo botín', () => {
    const a = withProps();
    const b = withProps();
    run(a, 400, move(127, 40));
    run(b, 400, move(127, 40));
    expect(liveProps(a)).toEqual(liveProps(b));
    expect(a.terrain.live).toEqual(b.terrain.live);
  });
});

describe('imán', () => {
  test('atrae todos los datos del suelo a quien lo recoge', () => {
    const sim = quietSim();
    for (let k = 0; k < 6; k++) dropPickup(sim, PICKUP.xp, 1, 400 + k * 60, -300);
    dropPickup(sim, PICKUP.magnet, 1, 0, 0);
    run(sim, 2);
    let pulled = 0;
    for (let k = 0; k < sim.pickups.top; k++) if (sim.pickups.alive[k] && sim.pickups.to[k] === 1) pulled++;
    expect(pulled).toBe(6);
    run(sim, 240);
    let left = 0;
    for (let k = 0; k < sim.pickups.top; k++) if (sim.pickups.alive[k]) left++;
    expect(left).toBe(0);
    expect(sim.probes[0]!.xp + (sim.probes[0]!.level - 1)).toBeGreaterThan(0);
  });

  test('no arrastra monedas ni polvo', () => {
    const sim = quietSim();
    dropPickup(sim, PICKUP.coin, 1, 500, 0);
    dropPickup(sim, PICKUP.magnet, 1, 0, 0);
    run(sim, 30);
    let coins = 0;
    for (let k = 0; k < sim.pickups.top; k++) if (sim.pickups.alive[k] && sim.pickups.kind[k] === PICKUP.coin) coins++;
    expect(coins).toBe(1);
    expect(sim.loot[0]!.coins).toBe(0);
  });
});
