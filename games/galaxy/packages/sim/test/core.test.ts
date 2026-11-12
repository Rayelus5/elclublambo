import { describe, expect, test } from 'vitest';
import { createSim, dealDamage, dropPickup, IDLE, PICKUP, runSummary, spawnEnemy, SpatialGrid, stateHash, step, type Sim } from '../src/index';
import { move, options, pick, quietSim, run, tinyContent } from './fixtures';

// The core of the run simulation (GDD §5.1, §5.7, §18.4): probes driven by per-tick inputs, contact damage, data
// fragments that level you up into a 1-of-3 choice that freezes the world, and full determinism.

const dummy = (sim: Sim) => sim.content.enemies.find((e) => e.id === 'dummy')!;
const src = { probe: 0, weapon: null, relic: null, element: null };

describe('movimiento', () => {
  test('la sonda se mueve a su velocidad y en diagonal no va más rápido', () => {
    const sim = quietSim();
    run(sim, 60, move(127, 0));
    expect(sim.probes[0]!.x).toBeCloseTo(60, 6);
    expect(sim.probes[0]!.y).toBeCloseTo(0, 6);

    const diag = quietSim();
    run(diag, 60, move(127, 127));
    const p = diag.probes[0]!;
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(60, 6);
  });

  test('media palanca del mando va a media velocidad y guarda la posición anterior para interpolar', () => {
    const sim = quietSim();
    run(sim, 60, move(0, 64));
    const p = sim.probes[0]!;
    expect(p.y).toBeCloseTo((60 * 64) / 127, 6);
    expect(p.y - p.py).toBeCloseTo(64 / 127, 6);
  });
});

describe('determinismo', () => {
  const script = (sim: Sim) => {
    for (let t = 0; t < 3000; t++) step(sim, [move(((t * 37) % 255) - 127, ((t * 91) % 255) - 127)]);
  };

  test('misma semilla y mismas entradas dan el mismo hash; otra semilla, otro hash', () => {
    const a = createSim(options(tinyContent()));
    const b = createSim(options(tinyContent()));
    const c = createSim(options(tinyContent(), { seed: '424243' }));
    for (const s of [a, b, c]) {
      spawnEnemy(s, dummy(s), 40, 40);
      script(s);
    }
    expect(stateHash(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(c)).not.toBe(stateHash(a));
  });
});

describe('daño a la sonda y muerte', () => {
  test('tocar a un enemigo quita vida y da 0,5 s de invulnerabilidad', () => {
    const sim = quietSim();
    spawnEnemy(sim, dummy(sim), 0, 0);
    run(sim, 1);
    expect(sim.probes[0]!.hp).toBe(90);
    expect(sim.events).toContainEqual({ t: 'hurt', probe: 0, amount: 10 });
    run(sim, 29);
    expect(sim.probes[0]!.hp).toBe(90);
    run(sim, 1);
    expect(sim.probes[0]!.hp).toBe(80);
  });

  test('con 2 sondas cada una sigue su entrada y la partida acaba cuando caen las dos', () => {
    const sim = quietSim(undefined, { probes: [{ probe: 'lumen', relics: [] }, { probe: 'lumen', relics: [] }] });
    const [a, b] = sim.probes;
    const ax = a!.x;
    const bx = b!.x;
    step(sim, [move(127, 0), move(-127, 0)]);
    expect(a!.x).toBeGreaterThan(ax);
    expect(b!.x).toBeLessThan(bx);

    a!.hp = 5;
    spawnEnemy(sim, dummy(sim), a!.x, a!.y);
    step(sim, [IDLE, IDLE]);
    expect(a!.alive).toBe(false);
    expect(sim.events).toContainEqual({ t: 'probeDown', probe: 0 });
    expect(sim.status).toBe('running');

    b!.hp = 5;
    spawnEnemy(sim, dummy(sim), b!.x, b!.y);
    step(sim, [IDLE, IDLE]);
    expect(sim.status).toBe('dead');
    expect(runSummary(sim).outcome).toBe('dead');
    const tick = sim.tick;
    step(sim, [IDLE, IDLE]);
    expect(sim.tick).toBe(tick);
  });
});

describe('experiencia y mejoras', () => {
  test('la experiencia cae, la recogida la atrae, sube de nivel y abre una oferta de 3 que congela el mundo', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, dummy(sim), 20, 0);
    dealDamage(sim, e, 1000, src);
    expect(sim.kills).toBe(1);
    run(sim, 60);
    const p = sim.probes[0]!;
    expect(p.level).toBe(2);
    expect(p.xp).toBeCloseTo(20 - 11, 9);
    expect(sim.status).toBe('choosing');
    expect(p.offer).toHaveLength(3);

    const tick = sim.tick;
    run(sim, 10, move(127, 0));
    expect(sim.tick).toBe(tick);
    expect(p.x).toBe(0);

    const chosen = p.offer![1]!;
    step(sim, [pick(1)]);
    expect(sim.status).toBe('running');
    expect(p.offer).toBeNull();
    const owned = chosen.kind === 'weapon' ? p.weapons : p.passives;
    expect(owned).toContainEqual(expect.objectContaining({ id: chosen.id, level: chosen.level }));
  });

  test('varios niveles seguidos se eligen uno tras otro', () => {
    const sim = quietSim((c) => {
      c.enemies.find((e) => e.id === 'dummy')!.xp = 60;
    });
    dealDamage(sim, spawnEnemy(sim, dummy(sim), 10, 0), 1000, src);
    run(sim, 60);
    const p = sim.probes[0]!;
    // 60 fragments: 11 to level 2, 19 to level 3, 27 to level 4, 3 left over.
    expect(p.level).toBe(4);
    expect(p.xp).toBeCloseTo(3, 9);
    for (let i = 0; i < 3; i++) {
      expect(sim.status).toBe('choosing');
      step(sim, [pick(0)]);
    }
    expect(sim.status).toBe('running');
  });

  test('una elección fuera de rango se ignora', () => {
    const sim = quietSim();
    dealDamage(sim, spawnEnemy(sim, dummy(sim), 10, 0), 1000, src);
    run(sim, 60);
    step(sim, [pick(5)]);
    expect(sim.status).toBe('choosing');
    step(sim, [pick(-1)]);
    expect(sim.status).toBe('choosing');
  });
});

describe('piscinas llenas', () => {
  test('no rompe nada: spawn devuelve −1 y la experiencia sobrante se suma a la recogida más antigua', () => {
    const sim = quietSim((c) => {
      c.limits.enemies = 4;
      c.limits.pickups = 3;
    });
    const ids = [0, 1, 2, 3, 4].map((i) => spawnEnemy(sim, dummy(sim), 500 + i * 20, 500));
    expect(ids).toEqual([0, 1, 2, 3, -1]);
    for (const e of ids.slice(0, 4)) dealDamage(sim, e, 1000, src);
    dealDamage(sim, spawnEnemy(sim, dummy(sim), 600, 500), 1000, src);
    expect(sim.pickups.count).toBe(3);
    let total = 0;
    for (let i = 0; i < sim.pickups.cap; i++) if (sim.pickups.alive[i]) total += sim.pickups.value[i]!;
    expect(total).toBe(5 * 20);
  });

  test('un índice reutilizado cambia de generación', () => {
    const sim = quietSim();
    const e = spawnEnemy(sim, dummy(sim), 300, 0);
    const gen = sim.enemies.gen[e]!;
    dealDamage(sim, e, 1000, src);
    expect(spawnEnemy(sim, dummy(sim), 300, 0)).toBe(e);
    expect(sim.enemies.gen[e]).toBe((gen + 1) & 0xffff);
  });
});

describe('rejilla espacial', () => {
  test('devuelve los vecinos en el mismo orden siempre: celdas en orden fijo y, dentro, por orden de llegada', () => {
    const g = new SpatialGrid(48);
    g.insert(7, 100, 100);
    g.insert(3, 10, 10);
    g.insert(9, 12, 14);
    g.insert(1, 500, 500);
    const out: number[] = [];
    const n = g.query(50, 50, 80, out);
    expect(out.slice(0, n)).toEqual([3, 9, 7]);
    const again: number[] = [];
    g.query(50, 50, 80, again);
    expect(again.slice(0, n)).toEqual([3, 9, 7]);
    g.clear();
    expect(g.query(50, 50, 80, out)).toBe(0);
  });
});

describe('kits de reparación', () => {
  // The share is the sector's `repairHeal` (the Nebula's is 20 % since the owner's panel edit, synced in Nov plan B1).
  test('curan la parte de la vida máxima que dice el sector, sin pasarse', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    p.hp = 40;
    dropPickup(sim, PICKUP.repair, 1, 10, 0);
    run(sim, 30);
    expect(p.hp).toBeCloseTo(40 + 100 * sim.sector.drops.repairHeal, 6);
    p.hp = 90;
    dropPickup(sim, PICKUP.repair, 1, 10, 0);
    run(sim, 30);
    expect(p.hp).toBe(100);
  });

  test('las élites siempre sueltan uno y los demás, rara vez', () => {
    const sim = quietSim((c) => {
      c.sectors[0]!.drops.repair = 1;
    });
    dealDamage(sim, spawnEnemy(sim, sim.content.enemies.find((e) => e.id === 'dummy')!, 300, 0), 1e9, { probe: 0, weapon: null, relic: null, element: null });
    let repairs = 0;
    for (let i = 0; i < sim.pickups.top; i++) if (sim.pickups.alive[i] && sim.pickups.kind[i] === PICKUP.repair) repairs++;
    expect(repairs).toBe(1);
    const elite = quietSim();
    dealDamage(elite, spawnEnemy(elite, elite.content.enemies.find((e) => e.id === 'dummy')!, 300, 0, { elite: elite.content.elites[1]! }), 1e9, {
      probe: 0,
      weapon: null,
      relic: null,
      element: null,
    });
    repairs = 0;
    for (let i = 0; i < elite.pickups.top; i++) if (elite.pickups.alive[i] && elite.pickups.kind[i] === PICKUP.repair) repairs++;
    expect(repairs).toBe(1);
  });
});
