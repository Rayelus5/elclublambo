import { describe, expect, test } from 'vitest';
import { type Content, dealDamage, type EnemyDef, type Sim, spawnEnemy, STATE, stateHash, step, ticks } from '../src/index';
import { quietSim, run } from './fixtures';

// The new fauna behaviours of M3b-3 (GDD §5.5): swarms that circle and dive, healers and corruptors that tend their
// allies from afar, warned teleports and warned lances, and armour that one element goes through.

const ORB: EnemyDef = {
  id: 'orb',
  name: 'Orbitador',
  family: 'swarm',
  sprite: 'mite',
  hp: 50,
  speed: 80,
  damage: 0,
  radius: 6,
  xp: 1,
  behavior: { kind: 'orbit', radius: 80, turn: 60, every: 100, diveSpeed: 220, diveTime: 0.5 },
};
const MEDIC: EnemyDef = {
  id: 'medic',
  name: 'Sanadora',
  family: 'healer',
  sprite: 'mite',
  hp: 40,
  speed: 0,
  damage: 0,
  radius: 8,
  xp: 1,
  behavior: { kind: 'support', effect: 'heal', amount: 0.2, range: 100, cooldown: 2, keep: 150 },
};
const WARDEN: EnemyDef = { ...MEDIC, id: 'warden', family: 'healer', behavior: { kind: 'support', effect: 'shield', amount: 0.5, range: 100, cooldown: 1, keep: 150 } };
const BLINKER: EnemyDef = {
  id: 'blinker',
  name: 'Saltador',
  family: 'charger',
  sprite: 'mite',
  hp: 30,
  speed: 50,
  damage: 0,
  radius: 7,
  xp: 1,
  behavior: { kind: 'blink', range: 200, offset: 40, windup: 0.6, cooldown: 3 },
};
const LANCER: EnemyDef = {
  id: 'lancer',
  name: 'Lancero',
  family: 'shooter',
  sprite: 'mite',
  hp: 30,
  speed: 40,
  damage: 0,
  radius: 8,
  xp: 1,
  behavior: { kind: 'lancer', range: 200, windup: 0.8, cooldown: 3, bulletSpeed: 300, bulletDamage: 12 },
};
const FLOE: EnemyDef = {
  id: 'test-floe',
  name: 'Témpano',
  family: 'armored',
  sprite: 'shell',
  hp: 1000,
  speed: 0,
  damage: 0,
  radius: 13,
  xp: 1,
  behavior: { kind: 'armored', arc: 120, reduction: 0.75, turnRate: 0, weakTo: 'burn' },
};

const withFoes = (c: Content) => c.enemies.push(ORB, MEDIC, WARDEN, BLINKER, LANCER, FLOE);
const world = () => {
  const sim = quietSim(withFoes);
  // No critical hits: damage comparisons are exact.
  sim.probes[0]!.stats.crit = 0;
  return sim;
};
const def = (sim: Sim, id: string) => sim.content.enemies.find((e) => e.id === id)!;
const dist = (sim: Sim, e: number) => Math.hypot(sim.enemies.x[e]! - sim.probes[0]!.x, sim.enemies.y[e]! - sim.probes[0]!.y);
const bearing = (sim: Sim, e: number) => Math.atan2(sim.enemies.y[e]! - sim.probes[0]!.y, sim.enemies.x[e]! - sim.probes[0]!.x);
const liveShots = (sim: Sim) => {
  let n = 0;
  for (let i = 0; i < sim.foeShots.top; i++) if (sim.foeShots.alive[i]) n++;
  return n;
};
const src = { probe: 0, weapon: null, relic: null, element: null };
/** The spatial grid is rebuilt after the enemies move, so newcomers are in it from the second tick: pulse then. */
const pulseOnTick2 = (sim: Sim, e: number) => (sim.enemies.timer[e] = 2);

describe('orbit', () => {
  test('rodea a la sonda a su radio y gira', () => {
    const sim = world();
    const e = spawnEnemy(sim, def(sim, 'orb'), 200, 0);
    run(sim, ticks(4));
    expect(dist(sim, e)).toBeGreaterThan(80 * 0.85);
    expect(dist(sim, e)).toBeLessThan(80 * 1.15);
    const a = bearing(sim, e);
    run(sim, ticks(0.5));
    const turned = Math.abs(Math.atan2(Math.sin(bearing(sim, e) - a), Math.cos(bearing(sim, e) - a)));
    expect(turned).toBeGreaterThan((10 * Math.PI) / 180);
    expect(dist(sim, e)).toBeGreaterThan(80 * 0.85);
  });

  test('cada `every` segundos se lanza en línea recta contra la sonda', () => {
    const sim = quietSim((c) => c.enemies.push({ ...ORB, behavior: { ...ORB.behavior, every: 3 } as EnemyDef['behavior'] }));
    const e = spawnEnemy(sim, def(sim, 'orb'), 200, 0);
    let closest = Infinity;
    for (let k = 0; k < ticks(6); k++) {
      run(sim, 1);
      closest = Math.min(closest, dist(sim, e));
    }
    expect(closest).toBeLessThan(80 - 40);
  });
});

describe('support', () => {
  test('cura a un aliado herido en su alcance, sin pasar de su vida máxima, con enfriamiento', () => {
    const sim = world();
    pulseOnTick2(sim, spawnEnemy(sim, def(sim, 'medic'), 150, 0));
    const ally = spawnEnemy(sim, def(sim, 'dummy'), 150, 40);
    const full = spawnEnemy(sim, def(sim, 'dummy'), 150, -40);
    const far = spawnEnemy(sim, def(sim, 'dummy'), 150, 400);
    sim.enemies.hp[ally] = 5;
    sim.enemies.hp[full] = 9.9;
    sim.enemies.hp[far] = 5;
    run(sim, 2);
    expect(sim.enemies.hp[ally]).toBeCloseTo(7);
    expect(sim.enemies.hp[full]).toBeCloseTo(10);
    expect(sim.enemies.hp[far]).toBeCloseTo(5);
    run(sim, ticks(2) - 4);
    expect(sim.enemies.hp[ally]).toBeCloseTo(7);
    run(sim, 4);
    expect(sim.enemies.hp[ally]).toBeCloseTo(9);
  });

  test('no se cura a sí misma, ni a un jefe, ni revive a un muerto', () => {
    const sim = world();
    const medic = spawnEnemy(sim, def(sim, 'medic'), 150, 0);
    pulseOnTick2(sim, medic);
    const dead = spawnEnemy(sim, def(sim, 'dummy'), 150, 30);
    const boss = spawnEnemy(sim, def(sim, 'dummy'), 150, -30);
    sim.enemies.hp[medic] = 20;
    sim.enemies.kill(dead);
    sim.enemies.boss[boss] = 1;
    sim.enemies.hp[boss] = 5;
    run(sim, 2);
    expect(sim.enemies.hp[medic]).toBeCloseTo(20);
    expect(sim.enemies.alive[dead]).toBe(0);
    expect(sim.enemies.hp[boss]).toBeCloseTo(5);
  });

  test('el escudo sube con cada pulso y nunca pasa de una vida máxima', () => {
    const sim = world();
    pulseOnTick2(sim, spawnEnemy(sim, def(sim, 'warden'), 150, 0));
    const ally = spawnEnemy(sim, def(sim, 'dummy'), 150, 40);
    run(sim, 2);
    expect(sim.enemies.shield[ally]).toBeCloseTo(5);
    run(sim, ticks(5));
    expect(sim.enemies.shield[ally]).toBeCloseTo(10);
  });

  test('dos sanadoras que se curan entre sí caen igual ante un daño constante', () => {
    const sim = world();
    const a = spawnEnemy(sim, def(sim, 'medic'), 150, 0);
    const b = spawnEnemy(sim, def(sim, 'medic'), 150, 30);
    pulseOnTick2(sim, a);
    pulseOnTick2(sim, b);
    let k = 0;
    // 20 % of their life per second against 20 % every 2 s.
    while ((sim.enemies.alive[a] || sim.enemies.alive[b]) && k < ticks(20)) {
      if (sim.enemies.alive[a]) dealDamage(sim, a, (40 * 0.2) / 60, src);
      if (sim.enemies.alive[b]) dealDamage(sim, b, (40 * 0.2) / 60, src);
      run(sim, 1);
      k++;
    }
    expect(sim.enemies.alive[a]).toBe(0);
    expect(sim.enemies.alive[b]).toBe(0);
  });

  test('se mantiene a su distancia de la sonda', () => {
    const sim = quietSim((c) => c.enemies.push({ ...MEDIC, speed: 60 }));
    const e = spawnEnemy(sim, def(sim, 'medic'), 40, 0);
    run(sim, ticks(4));
    expect(dist(sim, e)).toBeGreaterThan(150 * 0.8);
    expect(dist(sim, e)).toBeLessThan(150 * 1.2);
  });
});

describe('blink', () => {
  test('marca un punto detrás de la sonda, espera su aviso y salta allí', () => {
    const sim = world();
    const e = spawnEnemy(sim, def(sim, 'blinker'), 150, 0);
    step(sim, [{ mx: 0, my: 0, aim: -1, pick: -1 }]);
    expect(sim.enemies.state[e]).toBe(STATE.aim);
    expect(sim.events.some((v) => v.t === 'telegraph' && v.kind === 'blink')).toBe(true);
    expect(sim.enemies.tx[e]).toBeCloseTo(sim.probes[0]!.x - 40, 0);
    expect(sim.enemies.ty[e]).toBeCloseTo(sim.probes[0]!.y, 0);
    run(sim, ticks(0.6) - 2);
    expect(sim.enemies.x[e]).toBeCloseTo(150, 0);
    let jumped = false;
    for (let k = 0; k < 3 && !jumped; k++) {
      run(sim, 1);
      jumped = sim.events.some((v) => v.t === 'blink');
    }
    expect(jumped).toBe(true);
    expect(Math.hypot(sim.enemies.x[e]! - sim.enemies.tx[e]!, sim.enemies.y[e]! - sim.enemies.ty[e]!)).toBeLessThan(12);
    expect(sim.enemies.state[e]).toBe(STATE.move);
  });
});

describe('lancer', () => {
  test('apunta con su línea sin disparar y después lanza un proyectil en esa dirección', () => {
    const sim = world();
    const e = spawnEnemy(sim, def(sim, 'lancer'), 150, 0);
    step(sim, [{ mx: 0, my: 0, aim: -1, pick: -1 }]);
    expect(sim.enemies.state[e]).toBe(STATE.aim);
    expect(sim.events.some((v) => v.t === 'telegraph' && v.kind === 'lance')).toBe(true);
    run(sim, ticks(0.8) - 2);
    expect(liveShots(sim)).toBe(0);
    run(sim, 3);
    expect(liveShots(sim)).toBe(1);
    let vx = 0;
    for (let i = 0; i < sim.foeShots.top; i++) if (sim.foeShots.alive[i]) vx = sim.foeShots.vx[i]!;
    expect(vx).toBeLessThan(0);
  });
});

describe('armored con debilidad', () => {
  test('el elemento débil atraviesa el blindaje de frente; sin elemento, no', () => {
    const sim = world();
    const hit = (y: number, x: number, element: 'burn' | null) => {
      const e = spawnEnemy(sim, def(sim, 'test-floe'), x, y);
      // Facing the probe (at the origin).
      const before = sim.enemies.hp[e]!;
      dealDamage(sim, e, 100, { ...src, element, x: 0, y: 0 });
      return before - sim.enemies.hp[e]!;
    };
    const plainFront = hit(0, 120, null);
    const burnFront = hit(300, 120, 'burn');
    expect(plainFront).toBeCloseTo(25, 0);
    expect(burnFront).toBeGreaterThanOrEqual(100);
  });
});

describe('varias sondas', () => {
  test('saltos y lanzas apuntan a la sonda viva más cercana, sin NaN', () => {
    const sim = quietSim(withFoes, { probes: [{ probe: 'lumen', relics: [] }, { probe: 'lumen', relics: [] }] });
    const [p0, p1] = sim.probes;
    p0!.alive = false;
    p1!.x = 300;
    p1!.y = 0;
    const b = spawnEnemy(sim, def(sim, 'blinker'), 450, 0);
    const l = spawnEnemy(sim, def(sim, 'lancer'), 300, 150);
    run(sim, ticks(2));
    for (const e of [b, l]) {
      expect(Number.isFinite(sim.enemies.x[e]!)).toBe(true);
      expect(Number.isFinite(sim.enemies.tx[e]!)).toBe(true);
    }
    expect(Math.abs(sim.enemies.tx[b]! - (300 - 40))).toBeLessThan(2);
  });
});

test('la misma semilla y las mismas entradas dan el mismo hash', () => {
  const play = () => {
    const sim = world();
    for (const [id, x, y] of [
      ['orb', 200, 0],
      ['medic', 150, 50],
      ['warden', 150, -50],
      ['blinker', -150, 0],
      ['lancer', 0, 180],
      ['test-floe', 0, -120],
    ] as const)
      spawnEnemy(sim, def(sim, id), x, y);
    for (let k = 0; k < 600; k++) step(sim, [{ mx: k % 120 < 60 ? 1 : -1, my: 0, aim: -1, pick: -1 }]);
    return stateHash(sim);
  };
  expect(play()).toBe(play());
});
