import { describe, expect, test } from 'vitest';
import { DEFAULT_CONTENT, dealDamage, hudSnapshot, IDLE, runSummary, scaleAt, type Sim, step } from '../src/index';
import { quietSim, run } from './fixtures';

// Layers, the Static Core and extraction (GDD §5.1): a layer ends with its boss; beating it opens an extraction
// beacon for 60 s; staying inside for 8 s extracts with all the loot, ignoring it goes one layer deeper.

const src = { probe: 0, weapon: null, relic: null, element: null };

/** Layers of 20 s, an immortal unarmed probe, nothing spawning unless asked. */
function layered(over?: Parameters<typeof quietSim>[0], opts?: Parameters<typeof quietSim>[1]): Sim {
  const sim = quietSim((c) => {
    c.sectors[0]!.layerSeconds = 20;
    c.sectors[0]!.drops = { ...c.sectors[0]!.drops, bossCoins: 10, bossDust: 3 };
    over?.(c);
  }, opts);
  for (const p of sim.probes) p.hp = 1e9;
  return sim;
}
const events = (sim: Sim, t: string) => sim.events.filter((e) => e.t === t);
function untilBoss(sim: Sim): void {
  for (let i = 0; i < 20 * 60 + 5 && !sim.boss; i++) step(sim, sim.probes.map(() => IDLE));
}
function killBoss(sim: Sim): void {
  dealDamage(sim, sim.boss!.index, 1e9, src);
}

describe('capas y jefe', () => {
  test('al cumplirse la capa aparece el Núcleo de la Estática', () => {
    const sim = layered();
    run(sim, 20 * 60 - 1);
    expect(sim.phase).toBe('waves');
    step(sim, [IDLE]);
    expect(sim.phase).toBe('boss');
    expect(events(sim, 'bossSpawn')).toEqual([{ t: 'bossSpawn', boss: 'hive', layer: 1 }]);
    const b = sim.boss!;
    expect(sim.enemies.boss[b.index]).toBe(1);
    expect(sim.enemies.hp[b.index]).toBe(1800);
  });

  test('durante el jefe la aparición baja a la mitad', () => {
    const sim = layered((c) => {
      const s = c.sectors[0]!;
      s.spawns = [{ enemy: 'dummy', from: 0, weight: 1, group: [1, 1] }];
      s.density = { base: 2, perMinute: 0, max: 2, cap: 2000, bossFactor: 0.5 };
      s.layerSeconds = 10;
    });
    const dummy = sim.content.enemies.findIndex((e) => e.id === 'dummy');
    const dummies = () => {
      let n = 0;
      for (let i = 0; i < sim.enemies.top; i++) if (sim.enemies.alive[i] && !sim.enemies.boss[i] && sim.enemies.type[i] === dummy) n++;
      return n;
    };
    run(sim, 10 * 60);
    const before = dummies();
    expect(sim.phase).toBe('boss');
    run(sim, 10 * 60);
    const during = dummies() - before;
    expect(during).toBeGreaterThanOrEqual(Math.floor(before / 2) - 1);
    expect(during).toBeLessThanOrEqual(Math.ceil(before / 2) + 1);
  });

  test('la vida del jefe crece con la capa', () => {
    const sim = layered();
    sim.layer = 2;
    sim.loot.push({ coins: 0, dust: 0 });
    untilBoss(sim);
    expect(sim.enemies.hp[sim.boss!.index]).toBeCloseTo(1800 * 1.7, 9);
  });

  test('al vencerlo cae el cofre y se abre la baliza a 520 u', () => {
    const sim = layered();
    untilBoss(sim);
    killBoss(sim);
    expect(sim.bossKills).toBe(1);
    expect(sim.boss).toBeNull();
    expect(sim.phase).toBe('beacon');
    expect(events(sim, 'bossDown')).toHaveLength(1);
    const b = sim.beacon!;
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(520, 6);
    expect(b.holdNeeded).toBe(8 * 60);
    expect(b.t).toBe(60 * 60);
    let coins = 0;
    let dust = 0;
    for (let i = 0; i < sim.pickups.top; i++) {
      if (!sim.pickups.alive[i]) continue;
      if (sim.pickups.kind[i] === 1) coins += sim.pickups.value[i]!;
      if (sim.pickups.kind[i] === 2) dust += sim.pickups.value[i]!;
    }
    expect([coins, dust]).toEqual([10, 3]);
  });
});

describe('extracción', () => {
  test('dentro suma, fuera se detiene sin reiniciarse, y a los 8 s se extrae', () => {
    const sim = layered();
    untilBoss(sim);
    killBoss(sim);
    const p = sim.probes[0]!;
    const b = sim.beacon!;
    p.x = b.x;
    p.y = b.y;
    run(sim, 4 * 60);
    expect(sim.beacon!.hold).toBe(4 * 60);
    p.x = b.x + 500;
    run(sim, 2 * 60);
    expect(sim.beacon!.hold).toBe(4 * 60);
    p.x = b.x;
    run(sim, 4 * 60 - 1);
    expect(sim.status).toBe('running');
    step(sim, [IDLE]);
    expect(sim.status).toBe('extracted');
    expect(events(sim, 'extracted')).toHaveLength(1);
    expect(runSummary(sim)).toMatchObject({ outcome: 'extracted', depth: 1, bossKills: 1 });
  });

  test('con 2 sondas cuentan todas las vivas dentro', () => {
    const sim = layered(undefined, { probes: [{ probe: 'lumen', relics: [] }, { probe: 'lumen', relics: [] }] });
    untilBoss(sim);
    killBoss(sim);
    const [a, c] = sim.probes;
    const b = sim.beacon!;
    a!.x = b.x;
    a!.y = b.y;
    c!.x = b.x + 400;
    run(sim, 60);
    expect(sim.beacon!.hold).toBe(0);
    c!.alive = false;
    run(sim, 60);
    expect(sim.beacon!.hold).toBe(60);
  });

  test('si la baliza caduca, se baja una capa con más vida y daño', () => {
    const sim = layered();
    untilBoss(sim);
    killBoss(sim);
    const before = scaleAt(sim);
    run(sim, 60 * 60 - 1);
    expect(sim.layer).toBe(1);
    step(sim, [IDLE]);
    expect(events(sim, 'beaconClosed')).toHaveLength(1);
    expect(events(sim, 'layer')).toEqual([{ t: 'layer', layer: 2 }]);
    expect(sim.layer).toBe(2);
    expect(sim.phase).toBe('waves');
    expect(sim.beacon).toBeNull();
    const after = scaleAt(sim);
    expect(after.hp).toBeGreaterThan(before.hp * 1.4);
    expect(after.damage).toBeGreaterThan(before.damage * 1.15);
    expect(runSummary(sim).depth).toBe(2);
  });

  test('el botín cuenta en la capa en que se recoge', () => {
    const sim = layered((c) => {
      c.bosses[0]!.xp = 0; // no level-up choice in the middle of the walk
    });
    untilBoss(sim);
    killBoss(sim);
    run(sim, 60 * 60);
    expect(sim.layer).toBe(2);
    const p = sim.probes[0]!;
    // The chest is still on the ground: walk over it now, in layer 2.
    for (let i = 0; i < sim.pickups.top; i++) {
      if (!sim.pickups.alive[i]) continue;
      p.x = sim.pickups.x[i]!;
      p.y = sim.pickups.y[i]!;
      step(sim, [IDLE]);
    }
    expect(sim.loot[0]).toEqual({ coins: 0, dust: 0 });
    expect(sim.loot[1]).toEqual({ coins: 10, dust: 3 });
  });
});

describe('lo que ve el HUD', () => {
  test('vida, nivel, capa, tiempo de capa, botín, jefe y baliza', () => {
    const sim = layered();
    run(sim, 5 * 60);
    let hud = hudSnapshot(sim, 0);
    expect(hud).toMatchObject({ level: 1, layer: 1, phase: 'waves', boss: null, beacon: null, status: 'running', loot: { coins: 0, dust: 0 } });
    expect(hud.phaseLeft).toBeCloseTo(15, 6);
    untilBoss(sim);
    hud = hudSnapshot(sim, 0);
    expect(hud.boss).toMatchObject({ name: 'La Colmena Rota', title: 'Núcleo de la Estática', hp: 1800, maxHp: 1800, phase: 0 });
    killBoss(sim);
    step(sim, [IDLE]);
    hud = hudSnapshot(sim, 0);
    expect(hud.boss).toBeNull();
    expect(hud.beacon).not.toBeNull();
    expect(Math.hypot(hud.beacon!.dx, hud.beacon!.dy)).toBeCloseTo(520, 0);
    expect(hud.beacon!.left).toBeCloseTo(60 - 1 / 60, 6);
  });
});

test('el contenido por defecto tiene capas de 5 minutos y baliza de 60 s con 8 s dentro', () => {
  const s = DEFAULT_CONTENT.sectors[0]!;
  expect([s.layerSeconds, s.beacon.seconds, s.beacon.hold]).toEqual([300, 60, 8]);
});
