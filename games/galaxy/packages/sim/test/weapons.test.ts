import { describe, expect, test } from 'vitest';
import { applyOffer, AREA, type Content, IDLE, refreshStats, SHOT, type Sim, spawnEnemy, step } from '../src/index';
import { move, quietSim, run } from './fixtures';

// The probe's weapons (GDD §5.3): each one has its own role — the nearest target, a ring around you, a piercing line,
// orbiting orbs, a trail, a bouncing arc and drones — and its level row sets its numbers.

/** A quiet world with sturdy targets (life 100) and the probe holding only `weapon`. */
function armed(weapon: string, level = 1, over?: (c: Content) => void): Sim {
  const sim = quietSim((c) => {
    c.enemies.find((e) => e.id === 'dummy')!.hp = 100;
    over?.(c);
  });
  sim.rng.combat.chance = () => false; // no criticals: exact numbers
  sim.probes[0]!.weapons = [{ id: weapon, level, t: 0 }];
  return sim;
}
const target = (sim: Sim, x: number, y: number) => spawnEnemy(sim, sim.content.enemies.find((e) => e.id === 'dummy')!, x, y);
const lost = (sim: Sim, e: number) => 100 - sim.enemies.hp[e]!;
const fires = (sim: Sim, n: number) => {
  let count = 0;
  for (let i = 0; i < n; i++) {
    step(sim, [IDLE]);
    count += sim.events.filter((ev) => ev.t === 'fire').length;
  }
  return count;
};

describe('Pulso láser (bolt)', () => {
  test('dispara al enemigo más cercano dentro de su alcance', () => {
    const sim = armed('pulse');
    const near = target(sim, 100, 0);
    const far = target(sim, 0, 200);
    run(sim, 30);
    expect(lost(sim, near)).toBe(10);
    expect(lost(sim, far)).toBe(0);
  });

  test('sin nadie a su alcance no dispara', () => {
    const sim = armed('pulse');
    target(sim, 300, 0);
    expect(fires(sim, 120)).toBe(0);
    expect(sim.shots.count).toBe(0);
  });

  test('a nivel 3 dispara 2 a la vez y el Divisor de haz añade otro', () => {
    const sim = armed('pulse', 3);
    target(sim, 100, 0);
    target(sim, -100, 0);
    step(sim, [IDLE]);
    expect(sim.shots.count).toBe(2);
    const split = armed('pulse', 1);
    target(split, 100, 0);
    applyOffer(split, split.probes[0]!, { kind: 'passive', id: 'splitter', level: 1 });
    step(split, [IDLE]);
    expect(split.shots.count).toBe(2);
  });

  test('el Condensador acorta el enfriamiento real', () => {
    const plain = armed('pulse');
    target(plain, 100, 0).valueOf();
    plain.enemies.hp[0] = 1e9;
    const fast = armed('pulse');
    target(fast, 100, 0);
    fast.enemies.hp[0] = 1e9;
    fast.probes[0]!.passives.push({ id: 'capacitor', level: 5 });
    refreshStats(fast, fast.probes[0]!);
    // 0.9 s → 54 ticks; with 30 % less → 38 ticks.
    expect(fires(plain, 600)).toBe(Math.ceil(600 / 54));
    expect(fires(fast, 600)).toBe(Math.ceil(600 / 38));
  });
});

describe('Onda de choque (nova)', () => {
  test('daña y empuja lo que hay en su radio, y nada más', () => {
    const sim = armed('nova');
    const near = target(sim, 40, 0);
    const far = target(sim, 100, 0);
    step(sim, [IDLE]);
    expect(lost(sim, near)).toBe(14);
    expect(lost(sim, far)).toBe(0);
    run(sim, 20);
    expect(sim.enemies.x[near]).toBeGreaterThan(55);
  });

  test('el Amplificador sube el daño y la Lente el radio', () => {
    const sim = armed('nova');
    const p = sim.probes[0]!;
    p.passives.push({ id: 'amplifier', level: 5 }, { id: 'lens', level: 5 });
    refreshStats(sim, p);
    const e = target(sim, 80, 0);
    step(sim, [IDLE]);
    expect(lost(sim, e)).toBeCloseTo(14 * 1.5, 9);
  });
});

describe('Lanza de plasma (lance)', () => {
  test('atraviesa a 4 enemigos más el primero, sin golpear dos veces al mismo', () => {
    const sim = armed('lance');
    const line = [50, 80, 110, 140, 170, 200].map((x) => target(sim, x, 0));
    step(sim, [move(127, 0)]);
    run(sim, 60);
    expect(line.map((e) => lost(sim, e))).toEqual([18, 18, 18, 18, 18, 0]);
  });
});

describe('Satélites (orbit)', () => {
  test('golpean al pasar y respetan el intervalo de 0,5 s por enemigo', () => {
    const sim = armed('orbit', 1, (c) => {
      // Orbs that stand still on the circle: one sits on the target.
      c.weapons.find((w) => w.id === 'orbit')!.levels[0]!.speed = 0;
    });
    const e = target(sim, 46, 0);
    run(sim, 61);
    expect(lost(sim, e)).toBe(3 * 8);
  });

  test('giran alrededor de la sonda y la siguen', () => {
    const sim = armed('orbit');
    run(sim, 30, move(127, 0));
    const p = sim.probes[0]!;
    let orbs = 0;
    for (let i = 0; i < sim.shots.top; i++) {
      if (!sim.shots.alive[i]) continue;
      orbs++;
      expect(Math.hypot(sim.shots.x[i]! - p.x, sim.shots.y[i]! - p.y)).toBeCloseTo(46, 6);
    }
    expect(orbs).toBe(2);
  });
});

describe('Estela iónica (trail)', () => {
  test('solo deja charcos al moverse, con su radio y duración', () => {
    const sim = armed('trail');
    run(sim, 60);
    expect(sim.areas.count).toBe(0);
    run(sim, 60, move(127, 0));
    expect(sim.areas.count).toBeGreaterThanOrEqual(4);
    let i = 0;
    while (!sim.areas.alive[i]) i++;
    expect(sim.areas.radius[i]).toBe(14);
    run(sim, 2 * 60 + 2);
    expect(sim.areas.count).toBe(0);
  });

  test('un charco daña a quien lo pisa cada 0,3 s', () => {
    const sim = armed('trail');
    step(sim, [move(1, 0)]); // a puddle at the start
    const e = target(sim, 0.1, 0);
    sim.probes[0]!.x = 500; // the probe walks away; the puddle stays
    run(sim, 37);
    expect(lost(sim, e)).toBe(2 * 6);
  });
});

describe('Arco voltaico (ricochet)', () => {
  test('rebota hasta 3 veces sin repetir objetivo', () => {
    const sim = armed('arc');
    const group = [
      [80, 0],
      [120, 30],
      [160, 0],
      [200, 30],
      [240, 0],
    ].map(([x, y]) => target(sim, x!, y!));
    run(sim, 90);
    expect(group.map((e) => lost(sim, e))).toEqual([12, 12, 12, 12, 0]);
  });
});

describe('Dron centinela (drone)', () => {
  test('sigue a la sonda y dispara a lo que tiene a su alcance', () => {
    const sim = armed('drone');
    run(sim, 120, move(127, 0));
    const p = sim.probes[0]!;
    let drone = -1;
    for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i]) drone = i;
    expect(drone).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(sim.shots.x[drone]! - p.x, sim.shots.y[drone]! - p.y)).toBeLessThan(45);
    const e = target(sim, p.x + 150, p.y);
    run(sim, 90);
    expect(lost(sim, e)).toBeGreaterThanOrEqual(7);
  });
});

// ── M3b-1, Tarea 2: rayo continuo, lanzallamas, esquirlas y misiles ──────────────────────────────────────────────

const aimEast = { ...IDLE, aim: 0 };
const kindCount = (sim: Sim, kind: number) => {
  let n = 0;
  for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === kind) n++;
  return n;
};
const areaCount = (sim: Sim, kind: number) => {
  let n = 0;
  for (let i = 0; i < sim.areas.top; i++) if (sim.areas.alive[i] && sim.areas.kind[i] === kind) n++;
  return n;
};

describe('Rayo continuo (beam)', () => {
  test('se fija en el más cercano y daña todo lo que cruza su línea cada intervalo', () => {
    const sim = armed('beam');
    const near = target(sim, 60, 0);
    const behind = target(sim, 120, 0);
    const off = target(sim, 0, 100);
    run(sim, 10);
    expect(lost(sim, near)).toBe(10);
    expect(lost(sim, behind)).toBe(10);
    expect(lost(sim, off)).toBe(0);
  });

  test('si su objetivo muere, salta al siguiente', () => {
    const sim = armed('beam');
    const first = target(sim, 50, 0);
    sim.enemies.hp[first] = 4;
    const next = target(sim, 0, 80);
    run(sim, 30);
    expect(sim.enemies.alive[first]).toBe(0);
    expect(lost(sim, next)).toBeGreaterThan(0);
  });

  test('dura su duración y luego espera su enfriamiento; el Estabilizador la alarga', () => {
    const sim = armed('beam');
    target(sim, 60, 0);
    run(sim, 60);
    expect(kindCount(sim, SHOT.beam)).toBe(1);
    run(sim, 20);
    expect(kindCount(sim, SHOT.beam)).toBe(0);
    const long = armed('beam');
    target(long, 60, 0);
    applyOffer(long, long.probes[0]!, { kind: 'passive', id: 'stabilizer', level: 5 });
    run(long, 100);
    expect(kindCount(long, SHOT.beam)).toBe(1);
  });
});

describe('Lanzallamas (cone)', () => {
  test('daña dentro de su arco hacia donde apuntas, no detrás ni al lado', () => {
    const sim = armed('cone');
    const front = target(sim, 40, 0);
    const back = target(sim, -40, 0);
    const side = target(sim, 30, 30);
    for (let i = 0; i < 13; i++) step(sim, [aimEast]);
    expect(lost(sim, front)).toBe(12);
    expect(lost(sim, back)).toBe(0);
    expect(lost(sim, side)).toBe(0);
  });

  test('sigue a la sonda mientras dura', () => {
    const sim = armed('cone');
    target(sim, 40, 0);
    step(sim, [aimEast]);
    for (let i = 0; i < 20; i++) step(sim, [{ ...move(0, 127), aim: 0 }]);
    let found = false;
    for (let i = 0; i < sim.areas.top; i++) {
      if (sim.areas.alive[i] && sim.areas.kind[i] === AREA.cone) {
        expect(sim.areas.x[i]).toBeCloseTo(sim.probes[0]!.x, 9);
        expect(sim.areas.y[i]).toBeCloseTo(sim.probes[0]!.y, 9);
        found = true;
      }
    }
    expect(found).toBe(true);
    expect(areaCount(sim, AREA.cone)).toBe(1);
  });
});

describe('Esquirlas (radial)', () => {
  test('lanza su cantidad de proyectiles repartidos en 360°', () => {
    const sim = armed('shards');
    target(sim, 100, 0);
    step(sim, [IDLE]);
    expect(kindCount(sim, SHOT.shard)).toBe(6);
    const angles: number[] = [];
    for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === SHOT.shard) angles.push(sim.shots.angle[i]!);
    angles.sort((a, b) => a - b);
    for (let k = 1; k < angles.length; k++) expect(Math.abs(angles[k]! - angles[k - 1]! - 4096 / 6)).toBeLessThanOrEqual(1);
  });

  test('sin nadie a su alcance no dispara', () => {
    const sim = armed('shards');
    target(sim, 400, 0);
    expect(fires(sim, 120)).toBe(0);
    target(sim, 100, 0);
    expect(fires(sim, 2)).toBe(1);
  });

  test('perforan según su nivel y la Punta de taladro suma', () => {
    const sim = armed('shards', 3);
    target(sim, 100, 0);
    step(sim, [IDLE]);
    expect(kindCount(sim, SHOT.shard)).toBe(8);
    for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i]) expect(sim.shots.pierce[i]).toBe(1);
    const drilled = armed('shards', 3);
    target(drilled, 100, 0);
    applyOffer(drilled, drilled.probes[0]!, { kind: 'passive', id: 'drill', level: 1 });
    step(drilled, [IDLE]);
    for (let i = 0; i < drilled.shots.top; i++) if (drilled.shots.alive[i]) expect(drilled.shots.pierce[i]).toBe(2);
  });
});

describe('Misiles buscadores (homing)', () => {
  test('giran como mucho 240 °/s hacia el más cercano y estallan en su radio', () => {
    const sim = armed('homing');
    const prey = target(sim, 0, 120);
    const neighbour = target(sim, 16, 130);
    step(sim, [aimEast]);
    let missile = -1;
    for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === SHOT.missile) missile = i;
    expect(missile).toBeGreaterThanOrEqual(0);
    // Launched east (its aim); it already turns on the tick it is launched, by one turn at most.
    expect(Math.min(sim.shots.angle[missile]!, 4096 - sim.shots.angle[missile]!)).toBeLessThanOrEqual(46);
    let prev = sim.shots.angle[missile]!;
    for (let t = 0; t < 10; t++) {
      step(sim, [aimEast]);
      const now = sim.shots.angle[missile]!;
      let d = Math.abs(now - prev) % 4096;
      if (d > 2048) d = 4096 - d;
      expect(d).toBeLessThanOrEqual(Math.ceil((240 * 4096) / 360 / 60));
      prev = now;
    }
    run(sim, 120);
    expect(lost(sim, prey)).toBe(14);
    expect(lost(sim, neighbour)).toBe(14);
  });

  test('si su objetivo desaparece, sigue recto y caduca al agotar su alcance', () => {
    const sim = armed('homing');
    const prey = target(sim, 250, 0);
    step(sim, [IDLE]);
    sim.enemies.kill(prey);
    run(sim, 85);
    expect(kindCount(sim, SHOT.missile)).toBe(1);
    run(sim, 10);
    expect(kindCount(sim, SHOT.missile)).toBe(0);
  });
});

describe('Modificadores del arsenal', () => {
  test('el Acelerador lleva los proyectiles más lejos', () => {
    const plain = armed('pulse');
    target(plain, 350, 0);
    expect(fires(plain, 60)).toBe(0);
    const fast = armed('pulse');
    const far = target(fast, 350, 0);
    applyOffer(fast, fast.probes[0]!, { kind: 'passive', id: 'accelerator', level: 5 });
    run(fast, 60);
    expect(lost(fast, far)).toBe(10);
  });

  test('la Punta de taladro hace que el pulso atraviese a un enemigo más', () => {
    const sim = armed('pulse');
    const first = target(sim, 60, 0);
    const second = target(sim, 90, 0);
    applyOffer(sim, sim.probes[0]!, { kind: 'passive', id: 'drill', level: 1 });
    run(sim, 30);
    expect(lost(sim, first)).toBe(10);
    expect(lost(sim, second)).toBe(10);
  });

  test('con la piscina de disparos llena, disparar no lanza nada de más ni rompe', () => {
    const sim = armed('shards', 5, (c) => {
      c.limits.shots = 3;
    });
    for (let k = 0; k < 6; k++) target(sim, 60 + k * 10, 0);
    let most = 0;
    expect(() => {
      for (let t = 0; t < 300; t++) {
        step(sim, [IDLE]);
        most = Math.max(most, sim.shots.count);
      }
    }).not.toThrow();
    expect(most).toBe(3);
  });
});
