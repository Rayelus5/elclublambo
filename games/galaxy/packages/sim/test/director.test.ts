import { describe, expect, test } from 'vitest';
import { curseOf, dealDamage, DEFAULT_CONTENT, refreshStats, scaleAt, spawnEnemy, spawnPoint, type Sim } from '../src/index';
import { quietSim, run } from './fixtures';

// The spawn director (GDD §5.5–5.6): species join the sector over the first layer, density grows with time, waves
// arrive on schedule, nothing appears on screen, and everything scales with the minute and the layer.

const sector = DEFAULT_CONTENT.sectors[0]!;

/** The quiet world with the sector's real spawn table and a steady density. */
function spawning(over: Partial<typeof sector.density> = {}) {
  return quietSim((c) => {
    const s = c.sectors[0]!;
    s.spawns = structuredClone(sector.spawns);
    s.density = { base: 2, perMinute: 0, max: 2, cap: 60, bossFactor: 0.5, ...over };
  });
}

function census(sim: Sim): Record<string, number> {
  const out: Record<string, number> = {};
  for (let i = 0; i < sim.enemies.top; i++) {
    if (!sim.enemies.alive[i]) continue;
    const id = sim.content.enemies[sim.enemies.type[i]!]!.id;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

describe('qué sale y cuándo', () => {
  test('en la capa 1 una especie no sale antes de su segundo', () => {
    const sim = spawning({ cap: 400 });
    // Keep the probe safe: the test is about the director, not about surviving.
    sim.probes[0]!.hp = 1e9;
    run(sim, 59 * 60);
    expect(Object.keys(census(sim))).toEqual(['mite']);
    // Clear the field (nothing kills them here) so the next species has room.
    for (let i = 0; i < sim.enemies.top; i++) sim.enemies.kill(i);
    run(sim, 5 * 60);
    expect(census(sim)['cell'] ?? 0).toBeGreaterThan(0);
    expect(census(sim)['ray']).toBeUndefined();
  });

  test('desde la capa 2 salen todas desde el principio', () => {
    const sim = spawning({ cap: 400 });
    sim.probes[0]!.hp = 1e9;
    sim.layer = 2;
    sim.loot.push({ coins: 0, dust: 0 });
    sim.clocks['layerStart'] = 0;
    run(sim, 40 * 60);
    expect(Object.keys(census(sim)).sort()).toEqual(['cell', 'mite', 'ray', 'shell', 'spitter']);
  });

  test('no pasa del tope de enemigos vivos', () => {
    const sim = spawning({ base: 6, max: 6, cap: 25 });
    sim.probes[0]!.hp = 1e9;
    run(sim, 30 * 60);
    expect(sim.enemies.count).toBeLessThanOrEqual(25 + 8);
    expect(sim.enemies.count).toBeGreaterThanOrEqual(20);
  });

  test('la densidad crece con los minutos hasta su máximo', () => {
    const slow = spawning({ base: 0.2, perMinute: 0, max: 5, cap: 2000 });
    const fast = spawning({ base: 0.2, perMinute: 1, max: 5, cap: 2000 });
    for (const s of [slow, fast]) {
      s.probes[0]!.hp = 1e9;
      s.probes[0]!.stats.speed = 0;
      run(s, 120 * 60);
    }
    expect(fast.kills + fast.enemies.count).toBeGreaterThan(2 * (slow.kills + slow.enemies.count));
  });
});

describe('dónde sale', () => {
  test('aparece fuera de la vista máxima', () => {
    const sim = spawning();
    const { viewW, viewH } = sim.content.arena;
    for (let i = 0; i < 500; i++) {
      const p = spawnPoint(sim, sim.rng.spawn);
      const outside = Math.abs(p.x) > viewW / 2 || Math.abs(p.y) > viewH / 2;
      expect(outside).toBe(true);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(viewW / 2 + sim.content.arena.margin + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(viewH / 2 + sim.content.arena.margin + 1e-9);
    }
  });
});

describe('oleadas fijas', () => {
  test('el anillo de 24 ácaros a los 150 s y la ráfaga de 12 células a los 270 s', () => {
    const sim = quietSim((c) => {
      c.sectors[0]!.waves = structuredClone(sector.waves);
    });
    sim.probes[0]!.hp = 1e9;
    sim.probes[0]!.stats.speed = 0;
    run(sim, 150 * 60 - 1);
    expect(census(sim)['mite']).toBeUndefined();
    run(sim, 1);
    expect(census(sim)['mite']).toBe(24);
    run(sim, 120 * 60);
    expect(census(sim)['cell']).toBe(12);
  });
});

describe('escalado', () => {
  test('la vida y el daño suben con el minuto y la capa; la velocidad, con la capa', () => {
    const sim = quietSim();
    sim.tick = 5 * 3600;
    // Hand-checked from the test world's pinned scaling: +8 %/min and +50 %/layer of life, +4 %/min and +20 %/layer
    // of damage, +5 %/layer of speed.
    expect(scaleAt(sim)).toEqual({ hp: 1.4, damage: 1.2, speed: 1, elite: 0 });
    sim.layer = 2;
    const s = scaleAt(sim);
    expect(s.hp).toBeCloseTo(2.1, 12);
    expect(s.damage).toBeCloseTo(1.44, 12);
    expect(s.speed).toBeCloseTo(1.05, 12);
  });

  test('la probabilidad de élite sube con los minutos sin pasar de su tope', () => {
    const sim = quietSim((c) => {
      c.sectors[0]!.scaling = { ...c.sectors[0]!.scaling, eliteBase: 0, elitePerMinute: 0.006, eliteMax: 0.08 };
    });
    sim.tick = 10 * 3600;
    expect(scaleAt(sim).elite).toBeCloseTo(0.06, 12);
    sim.tick = 60 * 3600;
    expect(scaleAt(sim).elite).toBe(0.08);
  });
});

describe('Señal de la Estática (maldición)', () => {
  /** Dummies that never move, one per group, at a steady 2 groups per second. */
  function cursed(curse: number, over: { cap?: number; enemies?: number } = {}) {
    const sim = quietSim((c) => {
      const s = c.sectors[0]!;
      s.spawns = [{ enemy: 'dummy', from: 0, weight: 1, group: [1, 1] }];
      s.density = { base: 2, perMinute: 0, max: 2, cap: over.cap ?? 10, bossFactor: 0.5 };
      if (over.enemies) c.limits.enemies = over.enemies;
      c.probes[0]!.bonus = { curse };
    });
    return sim;
  }

  test('llegan más enemigos y caben más vivos', () => {
    const plain = cursed(0);
    const hexed = cursed(0.5);
    run(plain, 600);
    run(hexed, 600);
    expect(plain.enemies.count).toBe(10);
    expect(hexed.enemies.count).toBe(15);
    const early = cursed(0.5, { cap: 100 });
    const calm = cursed(0, { cap: 100 });
    run(early, 300);
    run(calm, 300);
    expect(early.enemies.count).toBeGreaterThan(calm.enemies.count * 1.4);
  });

  test('nunca pasa del tope de la piscina de enemigos', () => {
    const sim = cursed(0.5, { cap: 40, enemies: 12 });
    run(sim, 1200);
    expect(sim.enemies.count).toBeLessThanOrEqual(12);
  });

  test('con 2 sondas cuenta la mayor de las vivas', () => {
    const sim = quietSim((c) => (c.probes[0]!.bonus = {}), { probes: [{ probe: 'lumen', relics: [] }, { probe: 'lumen', relics: [] }] });
    const [a, b] = sim.probes;
    b!.passives.push({ id: 'static-signal', level: 5 });
    refreshStats(sim, b!);
    a!.passives.push({ id: 'static-signal', level: 2 });
    refreshStats(sim, a!);
    expect(curseOf(sim)).toBeCloseTo(0.5, 9);
    b!.alive = false;
    expect(curseOf(sim)).toBeCloseTo(0.2, 9);
  });

  test('sueltan más botín', () => {
    const drops = (curse: number) => {
      const sim = quietSim((c) => {
        c.sectors[0]!.drops = { ...c.sectors[0]!.drops, coin: 0.4 };
        c.probes[0]!.bonus = { curse };
      });
      const dummy = sim.content.enemies.find((e) => e.id === 'dummy')!;
      for (let k = 0; k < 300; k++) dealDamage(sim, spawnEnemy(sim, dummy, 200, 0), 1e6, { probe: 0, weapon: null, relic: null, element: null });
      let coins = 0;
      for (let i = 0; i < sim.pickups.top; i++) if (sim.pickups.alive[i] && sim.pickups.kind[i] === 1) coins++;
      return coins;
    };
    expect(drops(0.5)).toBeGreaterThan(drops(0) + 30);
  });
});
