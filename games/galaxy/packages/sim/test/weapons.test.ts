import { describe, expect, test } from 'vitest';
import { applyOffer, AREA, type Content, dealDamage, ELEMENT_IDS, hitArea, IDLE, persistentFor, refreshStats, SHOT, type Sim, spawnBoss, spawnEnemy, step } from '../src/index';
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

// ── M3b-1, Tarea 3: minas, disco, pozo gravitatorio, bombardeo y torreta ─────────────────────────────────────────

const slotsOf = (sim: Sim, kind: number) => {
  const out: number[] = [];
  for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === kind) out.push(i);
  return out;
};

describe('Minas de proximidad (mine)', () => {
  test('no estallan antes de armarse y estallan cuando alguien entra en su radio de disparo', () => {
    const sim = armed('mine');
    const victim = target(sim, 10, 0);
    run(sim, 28);
    expect(lost(sim, victim)).toBe(0);
    run(sim, 5);
    expect(lost(sim, victim)).toBe(30);
  });

  test('caducan sin nadie cerca', () => {
    const sim = armed('mine');
    step(sim, [IDLE]);
    const [first] = slotsOf(sim, SHOT.mine);
    expect(first).toBeDefined();
    run(sim, 470);
    expect(sim.shots.alive[first!]).toBe(1);
    run(sim, 20);
    expect(sim.shots.alive[first!]).toBe(0);
  });

  test('a nivel 3 deja 2 minas alrededor de la sonda', () => {
    const sim = armed('mine', 3);
    step(sim, [IDLE]);
    const mines = slotsOf(sim, SHOT.mine);
    expect(mines).toHaveLength(2);
    expect(sim.shots.x[mines[0]!]).not.toBeCloseTo(sim.shots.x[mines[1]!]!, 3);
  });
});

describe('Disco de retorno (boomerang)', () => {
  test('va hasta su alcance y vuelve a la sonda, atravesándolo todo a la ida y a la vuelta', () => {
    const sim = armed('boomerang');
    const a = target(sim, 50, 0);
    const b = target(sim, 80, 0);
    run(sim, 75);
    expect(lost(sim, a)).toBe(24);
    expect(lost(sim, b)).toBe(24);
    expect(slotsOf(sim, SHOT.disc)).toHaveLength(0);
  });

  test('no golpea al mismo enemigo dos veces dentro de su intervalo', () => {
    const sim = armed('boomerang');
    const turn = target(sim, 125, 0);
    run(sim, 75);
    expect(lost(sim, turn)).toBe(12);
  });
});

describe('Pozo gravitatorio (field)', () => {
  test('aparece en el enemigo más cercano, lo daña cada intervalo y atrae a los demás hacia su centro', () => {
    const sim = armed('field');
    const core = target(sim, 100, 0);
    const pulled = target(sim, 130, 20);
    const anchored = target(sim, 115, -25);
    sim.enemies.boss[anchored] = 1;
    const dist = () => Math.hypot(sim.enemies.x[pulled]! - 100, sim.enemies.y[pulled]! - 0);
    const before = dist();
    run(sim, 31);
    expect(lost(sim, core)).toBe(15);
    expect(dist()).toBeLessThan(before - 15);
    expect(sim.enemies.x[anchored]).toBe(115);
    expect(sim.enemies.y[anchored]).toBe(-25);
  });

  test('sin nadie a su alcance no aparece', () => {
    const sim = armed('field');
    target(sim, 400, 0);
    expect(fires(sim, 60)).toBe(0);
    target(sim, 100, 0);
    expect(fires(sim, 2)).toBe(1);
  });
});

describe('Bombardeo orbital (strike)', () => {
  test('marca enemigos distintos, no daña durante el aviso y estalla al acabarlo', () => {
    const sim = armed('strike');
    const ts = [target(sim, 100, 0), target(sim, 0, 100), target(sim, -100, 0)];
    run(sim, 30);
    expect(ts.map((e) => lost(sim, e))).toEqual([0, 0, 0]);
    run(sim, 10);
    const hits = ts.map((e) => lost(sim, e));
    expect(hits.filter((h) => h === 26)).toHaveLength(2);
    expect(hits.filter((h) => h === 0)).toHaveLength(1);
  });
});

describe('Torreta (turret)', () => {
  test('se queda donde la sonda la deja y dispara al más cercano con su cadencia', () => {
    const sim = armed('turret');
    const prey = target(sim, 0, 100);
    step(sim, [IDLE]);
    const [turret] = slotsOf(sim, SHOT.turret);
    expect(turret).toBeDefined();
    for (let i = 0; i < 100; i++) step(sim, [move(127, 0)]);
    expect(sim.shots.x[turret!]).toBe(0);
    expect(sim.shots.y[turret!]).toBe(0);
    expect(lost(sim, prey)).toBeGreaterThanOrEqual(14);
    expect(lost(sim, prey) % 7).toBe(0);
  });

  test('con su cantidad máxima, la nueva sustituye a la más vieja', () => {
    const sim = armed('turret');
    target(sim, 0, 100);
    step(sim, [IDLE]);
    for (let i = 0; i < 299; i++) step(sim, [i < 60 ? move(127, 0) : IDLE]);
    expect(slotsOf(sim, SHOT.turret)).toHaveLength(1);
    run(sim, 5);
    const now = slotsOf(sim, SHOT.turret);
    expect(now).toHaveLength(1);
    expect(sim.shots.x[now[0]!]).toBeCloseTo(sim.probes[0]!.x, 6);
  });
});

describe('Persistentes con la piscina llena', () => {
  test('si no caben todos, se reponen los que faltan sin reiniciar los que ya giran', () => {
    const sim = armed('orbit', 5, (c) => {
      c.limits.shots = 2;
    });
    step(sim, [IDLE]);
    const orbs = slotsOf(sim, SHOT.orb);
    expect(orbs).toHaveLength(2);
    const start = sim.shots.reach[orbs[0]!]!;
    run(sim, 10);
    const turned = (((sim.shots.reach[orbs[0]!]! - start) % 4096) + 4096) % 4096;
    // 230 °/s at level 5: about 26 angle steps per tick.
    expect(turned).toBeGreaterThan(200);
  });

  test('persistentFor da los disparos persistentes de un hueco', () => {
    const sim = armed('orbit', 3);
    step(sim, [IDLE]);
    expect(persistentFor(sim, sim.probes[0]!, 0)).toEqual(slotsOf(sim, SHOT.orb));
  });
});

// ── M3b-1, Tarea 5: especiales de las evoluciones ────────────────────────────────────────────────────────────────

describe('especiales de las evoluciones', () => {
  test('split: cada disparo se parte una sola vez en 3 fragmentos al 50 %, y los fragmentos no se parten', () => {
    const sim = armed('pulse-storm', 1, (c) => {
      c.weapons.find((w) => w.id === 'pulse-storm')!.levels[0]!.count = 1;
    });
    target(sim, 100, 0);
    const behind = target(sim, 140, 0);
    let most = 0;
    for (let t = 0; t < 30; t++) {
      step(sim, [IDLE]);
      most = Math.max(most, kindCount(sim, SHOT.split));
    }
    expect(most).toBe(3);
    expect(lost(sim, behind)).toBe(13);
  });

  test('echo: repite el disparo 9 ticks después, sin adelantar el enfriamiento', () => {
    const sim = armed('crystal-crown');
    target(sim, 100, 0);
    expect(fires(sim, 12)).toBe(2);
    expect(fires(sim, 50)).toBe(0);
    const drones = armed('sentinel-swarm');
    target(drones, 60, 0);
    expect(fires(drones, 20)).toBe(8);
  });

  test('vortex: la onda y el cono atraen en vez de empujar', () => {
    const plain = armed('nova');
    const pushed = target(plain, 50, 0);
    run(plain, 10);
    expect(plain.enemies.x[pushed]).toBeGreaterThan(50);
    const sim = armed('stellar-collapse');
    const drawn = target(sim, 80, 0);
    run(sim, 10);
    expect(sim.enemies.x[drawn]).toBeLessThan(80);
    const breath = armed('solar-breath');
    const fuel = target(breath, 100, 0);
    for (let i = 0; i < 30; i++) step(breath, [aimEast]);
    expect(breath.enemies.x[fuel]).toBeLessThan(100);
  });

  test('pierceAll: la lanza atraviesa la fila entera', () => {
    // Targets that give no data fragments: a level-up would freeze the world mid-flight.
    const sim = armed('neutron-lance', 1, (c) => (c.enemies.find((e) => e.id === 'dummy')!.xp = 0));
    const row = Array.from({ length: 12 }, (_, k) => target(sim, 30 + k * 28, 0));
    for (let i = 0; i < 60; i++) step(sim, [aimEast]);
    for (const e of row) expect(lost(sim, e)).toBeGreaterThanOrEqual(44);
  });

  test('chain: cada golpe salta a 2 vecinos al 50 %, y los saltos no vuelven a saltar', () => {
    const sim = armed('ion-ray', 1, (c) => {
      // Pinned numbers: mechanics tests do not follow calibration.
      c.weapons.find((w) => w.id === 'ion-ray')!.levels[0]!.count = 1;
      c.weapons.find((w) => w.id === 'ion-ray')!.levels[0]!.damage = 15;
      c.weapons.find((w) => w.id === 'ion-ray')!.element = null;
    });
    target(sim, 60, 0);
    const side = target(sim, 60, 60);
    const far = target(sim, 60, 130);
    step(sim, [IDLE]);
    expect(lost(sim, side)).toBeCloseTo(7.5, 9);
    expect(lost(sim, far)).toBe(0);
  });

  test('el elemento propio de una evolución va en cada golpe', () => {
    const sim = armed('neutron-lance');
    target(sim, 60, 0);
    const seen: string[] = [];
    for (let i = 0; i < 20; i++) {
      step(sim, [aimEast]);
      for (const ev of sim.events) if (ev.t === 'element') seen.push(ev.element);
    }
    expect(seen).toContain('breach');
  });

  test('al evolucionar, los persistentes del hueco se rehacen una vez y sin huérfanos', () => {
    const sim = armed('orbit', 5);
    const p = sim.probes[0]!;
    p.passives.push({ id: 'armor', level: 1 });
    step(sim, [IDLE]);
    expect(kindCount(sim, SHOT.orb)).toBe(4);
    applyOffer(sim, p, { kind: 'evolve', id: 'asteroid-belt', level: 1 });
    expect(persistentFor(sim, p, 0)).toEqual([]);
    step(sim, [IDLE]);
    expect(kindCount(sim, SHOT.orb)).toBe(6);
    run(sim, 30);
    expect(kindCount(sim, SHOT.orb)).toBe(6);
  });
});

// ── Revisión final de M3b-1 ──────────────────────────────────────────────────────────────────────────────────────

describe('revisión final', () => {
  test('un rayo con más de 8 enemigos en su línea golpea a cada uno una vez por intervalo, no a cada tick', () => {
    const sim = armed('beam');
    const row = Array.from({ length: 11 }, (_, k) => target(sim, 15 + k * 15, 0));
    run(sim, 18);
    for (const e of row) expect(lost(sim, e)).toBe(10);
  });

  test('un área golpea una vez a cada enemigo aunque una reacción busque vecinos a mitad del recorrido', () => {
    const sim = armed('dud', 1, (c) => (c.enemies.find((e) => e.id === 'dummy')!.hp = 1000));
    const ids = [
      [30, 0],
      [60, 30],
      [-50, 0],
      [0, 60],
      [-40, -40],
      [70, -20],
      [-70, 30],
      [10, -70],
    ].map(([x, y]) => target(sim, x!, y!));
    run(sim, 1);
    // A breach mark on one of them: the area's burn sets off an Implosion (it looks for neighbours) mid-loop.
    sim.enemies.mark[ids[5]!] = ELEMENT_IDS.indexOf('breach') + 1;
    sim.enemies.markT[ids[5]!] = 100;
    sim.events.length = 0;
    hitArea(sim, 0, 0, 90, 10, { probe: 0, weapon: null, relic: 0, element: 'burn', x: 0, y: 0 });
    const direct = ids.map((e) => sim.events.filter((ev) => ev.t === 'hit' && ev.element === 'burn' && ev.x === sim.enemies.x[e] && ev.y === sim.enemies.y[e]).length);
    expect(direct).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  test('el cono que atrae solo arrastra lo que tiene delante, no lo de detrás', () => {
    const sim = armed('solar-breath');
    const front = target(sim, 100, 0);
    const back = target(sim, -60, 0);
    for (let i = 0; i < 30; i++) step(sim, [aimEast]);
    expect(sim.enemies.x[front]).toBeLessThan(100);
    expect(sim.enemies.x[back]).toBe(-60);
  });
});

// ── Nov plan B3: arpón, honda, señuelo, faro y mortero ───────────────────────────────────────────────────────────

/** A weapon's first level, pinned by the test (mechanics tests do not follow calibration). */
const pin = (c: Content, id: string, row: Partial<Content['weapons'][number]['levels'][number]>) => Object.assign(c.weapons.find((w) => w.id === id)!.levels[0]!, row);
const dist = (sim: Sim, e: number, x = 0, y = 0) => Math.hypot(sim.enemies.x[e]! - x, sim.enemies.y[e]! - y);

describe('Arpón magnético (harpoon)', () => {
  const harpoon = (id = 'harpoon', over?: (c: Content) => void) =>
    armed(id, 1, (c) => {
      pin(c, id, { damage: 20, cooldown: 100, speed: 480, range: 200, knockback: 240 });
      over?.(c);
    });

  test('ensarta al más cercano, lo arrastra hacia ti y lo suelta cerca de la sonda', () => {
    const sim = harpoon();
    const prey = target(sim, 150, 0);
    const other = target(sim, 0, -170);
    run(sim, 4);
    expect(lost(sim, prey)).toBe(0);
    run(sim, 26);
    expect(lost(sim, prey)).toBe(20);
    expect(sim.enemies.x[prey]).toBeLessThan(140);
    run(sim, 70);
    expect(dist(sim, prey)).toBeGreaterThan(20);
    expect(dist(sim, prey)).toBeLessThan(45);
    expect(kindCount(sim, SHOT.harpoon)).toBe(0);
    expect(lost(sim, other)).toBe(0);
    // Let go: it stays where it was dropped.
    const at = [sim.enemies.x[prey], sim.enemies.y[prey]];
    run(sim, 20);
    expect([sim.enemies.x[prey], sim.enemies.y[prey]]).toEqual(at);
  });

  test('lo que arrastra golpea una vez a cada enemigo que toca por el camino, y a él no lo vuelve a dañar', () => {
    const sim = harpoon();
    const prey = target(sim, 150, 0);
    run(sim, 24);
    expect(lost(sim, prey)).toBe(20);
    // Off the harpoon's own line (3 + 6 < 10) but in the catch's way (6 + 6 > 10).
    const bx = sim.enemies.x[prey]! - 50;
    const bystander = target(sim, bx, 10);
    run(sim, 60);
    expect(lost(sim, bystander)).toBe(20);
    expect(lost(sim, prey)).toBe(20);
    // Shoved aside as the catch goes by, never taken along.
    expect(Math.abs(sim.enemies.x[bystander]! - bx)).toBeLessThan(3);
  });

  test('prefiere al más cercano que no está ya a tus pies; si no hay otro, ensarta a ese', () => {
    const sim = harpoon();
    const close = target(sim, 0, 25);
    const prey = target(sim, 120, 0);
    run(sim, 20);
    expect(lost(sim, prey)).toBe(20);
    expect(lost(sim, close)).toBe(0);
    const only = harpoon();
    const lone = target(only, 0, 25);
    run(only, 5);
    expect(lost(only, lone)).toBe(20);
  });

  test('a un Núcleo solo lo daña y el arpón vuelve vacío; a una élite la arrastra a la mitad de velocidad', () => {
    const sim = harpoon();
    const core = target(sim, 120, 0);
    sim.enemies.boss[core] = 1;
    run(sim, 100);
    expect(lost(sim, core)).toBe(20);
    expect([sim.enemies.x[core], sim.enemies.y[core]]).toEqual([120, 0]);
    expect(kindCount(sim, SHOT.harpoon)).toBe(0);

    const plain = harpoon();
    const a = target(plain, 150, 0);
    const elite = harpoon();
    const b = target(elite, 150, 0);
    elite.enemies.elite[b] = 1;
    run(plain, 25);
    run(elite, 25);
    const a0 = plain.enemies.x[a]!;
    const b0 = elite.enemies.x[b]!;
    run(plain, 12);
    run(elite, 12);
    expect(a0 - plain.enemies.x[a]!).toBeCloseTo(48, 6);
    expect(b0 - elite.enemies.x[b]!).toBeCloseTo(24, 6);
  });

  test('suelta a una élite volátil que muere en su línea: no te trae su estallido', () => {
    const sim = harpoon('harpoon', (c) => (c.enemies.find((e) => e.id === 'dummy')!.xp = 0));
    const bomb = target(sim, 150, 0);
    sim.enemies.elite[bomb] = 3;
    run(sim, 24);
    expect(sim.enemies.x[bomb]).toBeLessThan(140);
    dealDamage(sim, bomb, 1e6, { probe: 0, weapon: null, relic: null, element: null });
    expect(sim.enemies.fuseT[bomb]).toBeGreaterThan(0);
    const at = sim.enemies.x[bomb];
    run(sim, 5);
    expect(sim.enemies.x[bomb]).toBe(at);
  });

  test('el arpón de remolque atraviesa la fila entera y arrastra hasta su número de enemigos', () => {
    const sim = harpoon('tow-harpoon', (c) => {
      pin(c, 'tow-harpoon', { count: 3, range: 260 });
      c.enemies.find((e) => e.id === 'dummy')!.xp = 0;
    });
    const row = [40, 70, 100, 130, 160, 190].map((x) => target(sim, x, 0));
    run(sim, 160);
    for (const e of row) expect(lost(sim, e)).toBe(20);
    // The first three it skewered are at the probe's feet; the rest stay where they were.
    for (const e of row.slice(0, 3)) expect(dist(sim, e)).toBeLessThan(45);
    expect(row.slice(3).map((e) => sim.enemies.x[e])).toEqual([130, 160, 190]);
    expect(kindCount(sim, SHOT.harpoon)).toBe(0);
  });
});

describe('Honda gravitatoria (sling)', () => {
  const sling = (id = 'sling', over?: (c: Content) => void) =>
    armed(id, 1, (c) => {
      pin(c, id, { damage: 30, cooldown: 100, count: 1, speed: 360, range: 150, area: 30 });
      // Thrown enemies die: no data fragments, so no level-up freezes the world.
      c.enemies.find((e) => e.id === 'dummy')!.xp = 0;
      over?.(c);
    });

  test('agarra al enemigo corriente más cercano y lo lanza contra el grupo más denso: estalla al chocar y muere', () => {
    const sim = sling();
    const thrown = target(sim, 40, 0);
    const group = [target(sim, 30, 120), target(sim, 42, 126), target(sim, 18, 128)];
    const lone = target(sim, -110, 0);
    const kills = sim.kills;
    run(sim, 60);
    expect(sim.enemies.alive[thrown]).toBe(0);
    expect(sim.kills).toBe(kills + 1);
    for (const e of group) expect(lost(sim, e)).toBeGreaterThanOrEqual(30);
    expect(lost(sim, lone)).toBe(0);
    expect(kindCount(sim, SHOT.sling)).toBe(0);
  });

  test('lo lanzado golpea una vez a lo que roza por el camino', () => {
    const sim = sling();
    const thrown = target(sim, 40, 0);
    // In the way (6 + 6 > 10), far from the burst at the group.
    const grazed = target(sim, 50, 60);
    const group = [target(sim, 40, 170), target(sim, 52, 176), target(sim, 28, 178)];
    run(sim, 60);
    expect(sim.enemies.alive[thrown]).toBe(0);
    expect(lost(sim, grazed)).toBe(30);
    for (const e of group) expect(lost(sim, e)).toBeGreaterThanOrEqual(30);
  });

  test('nunca agarra a una élite ni a un Núcleo, que solo reciben el golpe; sin un enemigo corriente no dispara', () => {
    const sim = sling();
    const elite = target(sim, 40, 0);
    sim.enemies.elite[elite] = 1;
    const core = target(sim, 0, 50);
    sim.enemies.boss[core] = 1;
    expect(fires(sim, 120)).toBe(0);
    expect(kindCount(sim, SHOT.sling)).toBe(0);
    const plain = target(sim, 110, 0);
    expect(fires(sim, 2)).toBe(1);
    run(sim, 40);
    expect(sim.enemies.alive[plain]).toBe(0);
    expect(lost(sim, elite)).toBe(30);
    expect([sim.enemies.x[elite], sim.enemies.y[elite]]).toEqual([40, 0]);
    expect([sim.enemies.x[core], sim.enemies.y[core]]).toEqual([0, 50]);
  });

  test('la catapulta de singularidad deja al chocar un pozo breve que atrae a los de alrededor', () => {
    const sim = sling('singularity-catapult', (c) => pin(c, 'singularity-catapult', { knockback: 90, duration: 1 }));
    target(sim, 40, 0);
    const hit = target(sim, 40, 130);
    // Outside the burst (30 + 6), inside the pull.
    const pulled = target(sim, 92, 132);
    run(sim, 30);
    expect(lost(sim, hit)).toBeGreaterThanOrEqual(30);
    expect(lost(sim, pulled)).toBe(0);
    expect(sim.enemies.x[pulled]).toBeLessThan(85);
    expect(areaCount(sim, AREA.field)).toBe(1);
  });
});

describe('Señuelo holográfico (decoy)', () => {
  const decoy = (id = 'decoy') =>
    armed(id, 1, (c) => {
      pin(c, id, { damage: 40, cooldown: 100, count: 1, duration: 2, range: 90, area: 40 });
      // Something that walks: a sturdy chaser.
      c.enemies.push({ ...c.enemies.find((e) => e.id === 'dummy')!, id: 'runner', hp: 1000, speed: 30, xp: 0 });
    });
  const runner = (sim: Sim, x: number, y: number) => spawnEnemy(sim, sim.content.enemies.find((e) => e.id === 'runner')!, x, y);
  const lost1000 = (sim: Sim, e: number) => 1000 - sim.enemies.hp[e]!;

  test('deja un holograma donde estás que atrae a los enemigos y élites de su radio, no a los de fuera, y luego estalla', () => {
    const sim = decoy();
    const lured = runner(sim, 0, -60);
    const elite = runner(sim, -50, 30);
    sim.enemies.elite[elite] = 2;
    const outside = runner(sim, 0, 200);
    step(sim, [IDLE]);
    const [holo] = slotsOf(sim, SHOT.decoy);
    expect(holo).toBeDefined();
    expect([sim.shots.x[holo!], sim.shots.y[holo!]]).toEqual([0, 0]);
    // The probe walks off east; the lured ones go to the hologram, the others after the probe.
    for (let t = 0; t < 60; t++) step(sim, [move(127, 0)]);
    expect(Math.abs(sim.enemies.x[lured]!)).toBeLessThan(0.5);
    expect(sim.enemies.y[lured]).toBeGreaterThan(-35);
    expect(dist(sim, elite)).toBeLessThan(35);
    expect(sim.enemies.x[outside]).toBeGreaterThan(2);
    expect(lost1000(sim, lured)).toBe(0);
    // When its time is up it blows up on what it drew in, and they go back to the probe.
    run(sim, 62);
    expect(slotsOf(sim, SHOT.decoy)).toHaveLength(0);
    expect(lost1000(sim, lured)).toBe(40);
    expect(lost1000(sim, elite)).toBe(40);
    expect(lost1000(sim, outside)).toBe(0);
    const x = sim.enemies.x[lured]!;
    run(sim, 20);
    expect(sim.enemies.x[lured]).toBeGreaterThan(x + 3);
  });

  test('un Núcleo no le hace caso', () => {
    const sim = decoy();
    target(sim, 30, 0);
    step(sim, [IDLE]);
    expect(slotsOf(sim, SHOT.decoy)).toHaveLength(1);
    spawnBoss(sim);
    const core = sim.boss!.index;
    sim.enemies.x[core] = -40;
    sim.enemies.y[core] = 0;
    for (let t = 0; t < 40; t++) step(sim, [move(0, -127)]);
    expect(sim.enemies.y[core]).toBeLessThan(-5);
  });

  test('sin enemigos cerca no lo deja', () => {
    const sim = decoy();
    target(sim, 200, 0);
    expect(fires(sim, 60)).toBe(0);
    target(sim, 60, 0);
    expect(fires(sim, 2)).toBe(1);
  });

  test('la legión de espejismos deja varios hologramas y los repite poco después', () => {
    const sim = decoy('mirage-legion');
    pin(sim.content, 'mirage-legion', { count: 3 });
    target(sim, 30, 0);
    step(sim, [IDLE]);
    expect(slotsOf(sim, SHOT.decoy)).toHaveLength(3);
    run(sim, 10);
    expect(slotsOf(sim, SHOT.decoy)).toHaveLength(6);
  });
});

describe('Faro de fotones (lighthouse)', () => {
  const lighthouse = (id = 'lighthouse', row: Partial<Content['weapons'][number]['levels'][number]> = {}) =>
    armed(id, 1, (c) => pin(c, id, { damage: 10, count: 1, speed: 120, range: 120, area: 4, interval: 0.5, ...row }));
  const beams = (sim: Sim) => slotsOf(sim, SHOT.photon);

  test('un láser largo gira sin parar alrededor de la sonda y la sigue', () => {
    const sim = lighthouse();
    step(sim, [IDLE]);
    const [beam] = beams(sim);
    expect(beam).toBeDefined();
    const a0 = sim.shots.reach[beam!]!;
    run(sim, 30);
    const turned = (((sim.shots.reach[beam!]! - a0) % 4096) + 4096) % 4096;
    // 120 °/s: 682,67 angle steps in half a second.
    expect(turned).toBeCloseTo((120 * 4096) / 360 / 2, 6);
    for (let t = 0; t < 20; t++) step(sim, [move(127, 0)]);
    const p = sim.probes[0]!;
    expect([sim.shots.x[beam!], sim.shots.y[beam!]]).toEqual([p.x, p.y]);
    expect(Math.hypot(sim.shots.tx[beam!]! - p.x, sim.shots.ty[beam!]! - p.y)).toBeCloseTo(120, 6);
  });

  test('barre a cada enemigo que toca una vez por vuelta y no llega más allá de su largo', () => {
    const sim = lighthouse();
    const near = target(sim, 0, 60);
    const edge = target(sim, -110, 0);
    const far = target(sim, 0, -150);
    // One turn takes 3 s.
    run(sim, 180);
    expect(lost(sim, near)).toBe(10);
    expect(lost(sim, edge)).toBe(10);
    expect(lost(sim, far)).toBe(0);
    run(sim, 180);
    expect(lost(sim, near)).toBe(20);
  });

  test('aunque gire muy deprisa, golpea a cada enemigo como mucho una vez por intervalo', () => {
    // Four turns a second, a hit every 0.5 s at most: 4 hits in 2 s, not 8.
    const sim = lighthouse('lighthouse', { speed: 1440 });
    const e = target(sim, 0, 60);
    run(sim, 120);
    expect(lost(sim, e)).toBe(40);
  });

  test('el faro binario gira dos láseres opuestos', () => {
    const sim = lighthouse('binary-lighthouse', { count: 2 });
    step(sim, [IDLE]);
    const [a, b] = beams(sim);
    expect(beams(sim)).toHaveLength(2);
    const apart = (((sim.shots.reach[b!]! - sim.shots.reach[a!]!) % 4096) + 4096) % 4096;
    expect(apart).toBeCloseTo(2048, 6);
  });
});

describe('Mortero de racimo (mortar)', () => {
  const mortar = (id = 'mortar') => armed(id, 1, (c) => pin(c, id, { damage: 30, cooldown: 100, count: 4, speed: 200, range: 150, area: 30, interval: 0.5 }));
  const shells = (sim: Sim) => slotsOf(sim, SHOT.shell);
  const bomblets = (sim: Sim) => {
    const out: number[] = [];
    for (let i = 0; i < sim.areas.top; i++) if (sim.areas.alive[i] && sim.areas.kind[i] === AREA.bomblet) out.push(i);
    return out;
  };

  test('lanza un proyectil en parábola a su alcance por delante, que no choca en el aire y estalla al caer', () => {
    const sim = mortar();
    const landing = target(sim, 150, 0);
    const under = target(sim, 70, 0);
    step(sim, [IDLE]);
    const [shell] = shells(sim);
    expect(shell).toBeDefined();
    expect([sim.shots.tx[shell!], sim.shots.ty[shell!]]).toEqual([150, 0]);
    // 150 units at 200 per second: 45 ticks in the air.
    expect(sim.shots.life[shell!]).toBe(45);
    run(sim, 43);
    expect(lost(sim, landing)).toBe(0);
    expect(lost(sim, under)).toBe(0);
    run(sim, 2);
    expect(lost(sim, landing)).toBe(30);
    expect(lost(sim, under)).toBe(0);
    expect(shells(sim)).toHaveLength(0);
  });

  test('cuando te mueves cae por delante de donde vas; quieta, hacia donde apuntas', () => {
    const moving = mortar();
    target(moving, 0, -100);
    step(moving, [move(0, -127)]);
    const [a] = shells(moving);
    const p = moving.probes[0]!;
    expect(moving.shots.tx[a!]).toBeCloseTo(p.x, 6);
    expect(moving.shots.ty[a!]).toBeCloseTo(p.y - 150, 6);
    const still = mortar();
    target(still, -100, 0);
    step(still, [{ ...IDLE, aim: 2048 }]);
    const [b] = shells(still);
    expect(still.shots.tx[b!]).toBeCloseTo(-150, 6);
    expect(still.shots.ty[b!]).toBeCloseTo(0, 6);
  });

  test('al caer suelta sus bombitas alrededor, que solo hacen daño cuando acaba su aviso', () => {
    const sim = mortar();
    target(sim, 150, 0);
    run(sim, 45);
    const marks = bomblets(sim);
    expect(marks).toHaveLength(4);
    const ar = sim.areas;
    const victims = marks.map((i) => target(sim, ar.x[i]!, ar.y[i]!));
    for (const i of marks) expect(Math.hypot(ar.x[i]! - 150, ar.y[i]!)).toBeGreaterThan(10);
    const shortest = Math.min(...marks.map((i) => ar.ttl[i]!));
    const longest = Math.max(...marks.map((i) => ar.ttl[i]!));
    // Half a second of warning (a tick of it goes in the landing tick itself).
    expect(shortest).toBeGreaterThanOrEqual(29);
    const damage = marks.map((i) => ar.knockback[i]!);
    run(sim, shortest - 1);
    expect(victims.map((e) => lost(sim, e))).toEqual([0, 0, 0, 0]);
    run(sim, longest - shortest + 2);
    for (const [k, e] of victims.entries()) expect(lost(sim, e)).toBeGreaterThanOrEqual(damage[k]!);
    expect(bomblets(sim)).toHaveLength(0);
  });

  test('sin enemigos a su alcance no dispara', () => {
    const sim = mortar();
    target(sim, 0, 260);
    expect(fires(sim, 60)).toBe(0);
  });
});
