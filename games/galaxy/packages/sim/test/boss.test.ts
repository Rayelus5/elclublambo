import { describe, expect, test } from 'vitest';
import { angleTo, type BossPattern, type Content, contentSchema, dealDamage, DEFAULT_CONTENT, degToSteps, IDLE, nextLayer, type Sim, stateHash, step, ticks } from '../src/index';
import { quietSim } from './fixtures';

// The Static Core (GDD §5.5): phases that change with its life and patterns that are always announced first.

const src = { probe: 0, weapon: null, relic: null, element: null };

function withBoss(): Sim {
  const sim = quietSim((c) => {
    c.sectors[0]!.layerSeconds = 1;
  });
  sim.probes[0]!.hp = 1e9;
  sim.rng.combat.chance = () => false; // exact damage: no criticals
  for (let i = 0; i < 70 && !sim.boss; i++) step(sim, [IDLE]);
  return sim;
}
const bullets = (sim: Sim) => {
  const out: number[] = [];
  for (let i = 0; i < sim.foeShots.top; i++) if (sim.foeShots.alive[i]) out.push(i);
  return out;
};
/** Bullets by slot and generation: a slot freed and reused within one tick is still a new bullet. */
const bulletKeys = (sim: Sim) => new Set(bullets(sim).map((i) => i * 65536 + sim.foeShots.gen[i]!));

describe('fases', () => {
  test('cambian al bajar del 60 % y del 25 % de vida', () => {
    const sim = withBoss();
    const b = sim.boss!;
    dealDamage(sim, b.index, 1800 * 0.41, src);
    step(sim, [IDLE]);
    expect(sim.events).toContainEqual({ t: 'bossPhase', phase: 1 });
    expect(sim.boss!.phase).toBe(1);
    dealDamage(sim, b.index, 1800 * 0.37, src);
    step(sim, [IDLE]);
    expect(sim.boss!.phase).toBe(2);
  });
});

describe('patrones', () => {
  test('el primero (radial de 16) se anuncia 0,6 s antes y sale en 16 direcciones', () => {
    const sim = withBoss();
    let warned = -1;
    let fired = -1;
    for (let t = 0; t < 4 * 60 && fired < 0; t++) {
      step(sim, [IDLE]);
      if (warned < 0 && sim.events.some((e) => e.t === 'telegraph' && e.kind === 'burst')) warned = sim.tick;
      if (bullets(sim).length > 0) fired = sim.tick;
    }
    expect(warned).toBeGreaterThan(0);
    expect(fired - warned).toBe(36);
    const angles = bullets(sim)
      .map((i) => angleTo(sim.foeShots.vx[i]!, sim.foeShots.vy[i]!))
      .sort((a, b) => a - b);
    expect(angles).toHaveLength(16);
    for (let k = 1; k < 16; k++) expect(Math.abs(angles[k]! - angles[k - 1]! - 256)).toBeLessThanOrEqual(1);
  });

  test('en ciclo: radial, invocación de 6 ácaros y abanico apuntado de 5', () => {
    const sim = withBoss();
    const mite = sim.content.enemies.findIndex((e) => e.id === 'mite');
    const mites = () => {
      let n = 0;
      for (let i = 0; i < sim.enemies.top; i++) if (sim.enemies.alive[i] && !sim.enemies.boss[i] && sim.enemies.type[i] === mite) n++;
      return n;
    };
    // Three intervals of 2.6 s.
    let maxMites = 0;
    let aimed = false;
    for (let t = 0; t < 3 * 156 + 10; t++) {
      const before = new Set(bullets(sim));
      step(sim, [IDLE]);
      maxMites = Math.max(maxMites, mites());
      const fresh = bullets(sim).filter((i) => !before.has(i));
      if (fresh.length === 5) aimed = true;
    }
    expect(maxMites).toBe(6);
    expect(aimed).toBe(true);
  });

  test('la embestida de la fase 2 avisa y luego carga en línea recta', () => {
    const sim = withBoss();
    const b = sim.boss!;
    dealDamage(sim, b.index, 1800 * 0.41, src);
    let charge = false;
    for (let t = 0; t < 3 * 120 && !charge; t++) {
      step(sim, [IDLE]);
      charge = sim.events.some((e) => e.t === 'telegraph' && e.kind === 'charge');
    }
    expect(charge).toBe(true);
    const x0 = sim.enemies.x[b.index]!;
    const y0 = sim.enemies.y[b.index]!;
    for (let t = 0; t < 54 + 30; t++) step(sim, [IDLE]);
    const moved = Math.hypot(sim.enemies.x[b.index]! - x0, sim.enemies.y[b.index]! - y0);
    expect(moved).toBeGreaterThan(100);
  });

  test('la espiral de la fase 3 dispara una bala cada 0,08 s durante 2,5 s', () => {
    const sim = withBoss();
    const b = sim.boss!;
    dealDamage(sim, b.index, 1800 * 0.8, src);
    let started = -1;
    let shots = 0;
    for (let t = 0; t < 8 * 60; t++) {
      const before = bulletKeys(sim);
      step(sim, [IDLE]);
      const fresh = [...bulletKeys(sim)].filter((k) => !before.has(k)).length;
      if (fresh === 1) {
        if (started < 0) started = sim.tick;
        shots++;
      }
      if (started > 0 && sim.tick > started + 150) break;
    }
    expect(shots).toBeGreaterThanOrEqual(30);
    expect(shots).toBeLessThanOrEqual(33);
  });
});

/** A boss whose only phase repeats `pattern` every second (telegraph 0.5 s), almost still; spawned and returned. */
function withPattern(pattern: BossPattern, over?: (c: Content) => void): Sim {
  const sim = quietSim((c) => {
    c.sectors[0]!.layerSeconds = 1;
    c.bosses[0]!.phases = [{ below: 1, interval: 1, telegraph: 0.5, speed: 0.01, patterns: [pattern] }];
    over?.(c);
  });
  sim.probes[0]!.hp = 1e9;
  sim.rng.combat.chance = () => false;
  for (let i = 0; i < 70 && !sim.boss; i++) step(sim, [IDLE]);
  return sim;
}
/** Steps until the boss fires its pattern once (or 3 s). */
function untilFired(sim: Sim, fired: (s: Sim) => boolean): void {
  for (let t = 0; t < 3 * 60 && !fired(sim); t++) step(sim, [IDLE]);
}

describe('patrones nuevos', () => {
  test('wall: un anillo con un hueco sin balas de al menos `gap` grados', () => {
    const sim = withPattern({ kind: 'wall', count: 24, gap: 60, speed: 100, damage: 8 });
    untilFired(sim, (s) => bullets(s).length > 0);
    const angles = bullets(sim)
      .map((i) => angleTo(sim.foeShots.vx[i]!, sim.foeShots.vy[i]!))
      .sort((a, b) => a - b);
    expect(angles.length).toBeLessThan(24);
    expect(angles.length).toBeGreaterThanOrEqual(18);
    const gaps = angles.map((a, k) => (k === 0 ? a + 4096 - angles[angles.length - 1]! : a - angles[k - 1]!));
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(degToSteps(60) * 0.95);
  });

  test('mines: avisa con círculos cerca de la sonda y no hace daño antes de su retardo', () => {
    const sim = withPattern({ kind: 'mines', count: 3, spread: 60, radius: 30, delay: 1, damage: 20 });
    untilFired(sim, (s) => s.blasts.length > 0);
    expect(sim.blasts).toHaveLength(3);
    expect(sim.events.filter((e) => e.t === 'telegraph' && e.kind === 'explode')).toHaveLength(3);
    const p = sim.probes[0]!;
    for (const m of sim.blasts) expect(Math.hypot(m.x - p.x, m.y - p.y)).toBeLessThanOrEqual(60 + 1e-6);
    const hp = p.hp;
    for (let t = 0; t < ticks(1) - 2; t++) step(sim, [IDLE]);
    expect(p.hp).toBe(hp);
  });

  test('mines: al explotar hiere dentro de su radio, no fuera, y desaparecen', () => {
    // Delay 0.5 s: they go off before the boss lays the next ones (every 1 s).
    const inside = withPattern({ kind: 'mines', count: 2, spread: 0, radius: 30, delay: 0.5, damage: 20 });
    untilFired(inside, (s) => s.blasts.length > 0);
    const hp = inside.probes[0]!.hp;
    let blasted = false;
    for (let t = 0; t < ticks(0.5) + 2; t++) {
      step(inside, [IDLE]);
      blasted ||= inside.events.some((e) => e.t === 'blast');
    }
    expect(blasted).toBe(true);
    expect(inside.probes[0]!.hp).toBeLessThan(hp);
    expect(inside.blasts).toHaveLength(0);

    const outside = withPattern({ kind: 'mines', count: 2, spread: 0, radius: 30, delay: 0.5, damage: 20 });
    untilFired(outside, (s) => s.blasts.length > 0);
    const p = outside.probes[0]!;
    p.x += 500;
    const before = p.hp;
    for (let t = 0; t < ticks(0.5) + 2; t++) step(outside, [IDLE]);
    expect(p.hp).toBe(before);
  });

  test('blink: desaparece sin recibir daño, reaparece junto a la sonda y suelta un anillo', () => {
    const sim = withPattern({ kind: 'blink', offset: 100, windup: 0.5, count: 12, speed: 100, damage: 8 });
    const b = sim.boss!;
    untilFired(sim, (s) => s.events.some((e) => e.t === 'telegraph' && e.kind === 'blink'));
    expect(sim.boss!.active?.kind).toBe('blink');
    const hp = sim.enemies.hp[b.index]!;
    expect(dealDamage(sim, b.index, 100, src)).toBe(0);
    expect(sim.enemies.hp[b.index]).toBe(hp);
    let landed = false;
    for (let t = 0; t < ticks(0.5) + 2 && !landed; t++) {
      step(sim, [IDLE]);
      landed = sim.events.some((e) => e.t === 'blink');
    }
    expect(landed).toBe(true);
    const p = sim.probes[0]!;
    expect(Math.hypot(sim.enemies.x[b.index]! - p.x, sim.enemies.y[b.index]! - p.y)).toBeCloseTo(100, 0);
    expect(bullets(sim)).toHaveLength(12);
    expect(dealDamage(sim, b.index, 100, src)).toBeGreaterThan(0);
  });
});

test('un Núcleo aturdido durante el aviso de su embestida la cancela: no embiste sin un aviso nuevo', () => {
  const sim = withPattern({ kind: 'charge', windup: 0.9, dashSpeed: 300, dashTime: 0.6, damage: 24 });
  const b = sim.boss!;
  untilFired(sim, (s) => s.events.some((e) => e.t === 'telegraph' && e.kind === 'charge'));
  expect(sim.boss!.active?.kind).toBe('windup');
  sim.enemies.freezeT[b.index] = 15;
  step(sim, [IDLE]);
  expect(sim.boss!.active).toBeNull();
});

describe('Núcleo profundo', () => {
  const deep = (c: Content) => {
    c.bosses.push({ ...structuredClone(c.bosses[0]!), id: 'deep', name: 'El Eco Profundo', title: 'Núcleo abisal' });
    c.sectors[0]!.deepBoss = { boss: 'deep', every: 2 };
  };
  const reachBoss = (sim: Sim) => {
    for (let i = 0; i < 200 && !sim.boss; i++) step(sim, [IDLE]);
    return sim.boss!;
  };
  const killBoss = (sim: Sim) => dealDamage(sim, sim.boss!.index, 1e9, src);

  test('cada `every` capas aparece en vez del jefe del sector, y cuenta igual al caer', () => {
    const sim = withPattern({ kind: 'radial', count: 4, speed: 100, damage: 1 }, deep);
    expect(sim.boss!.def).toBe('hive');
    killBoss(sim);
    nextLayer(sim);
    const events: string[] = [];
    for (let i = 0; i < 200 && !sim.boss; i++) {
      step(sim, [IDLE]);
      for (const e of sim.events) if (e.t === 'bossSpawn') events.push(e.boss);
    }
    expect(sim.layer).toBe(2);
    expect(sim.boss!.def).toBe('deep');
    expect(events).toEqual(['deep']);
    const pickups = sim.pickups.count;
    killBoss(sim);
    expect(sim.bossKills).toBe(2);
    expect(sim.beacon).not.toBeNull();
    expect(sim.pickups.count).toBeGreaterThan(pickups);
    nextLayer(sim);
    expect(reachBoss(sim).def).toBe('hive');
  });

  test('un sector sin Núcleo profundo nunca lo trae', () => {
    const sim = withPattern({ kind: 'radial', count: 4, speed: 100, damage: 1 }, (c) => {
      c.bosses.push({ ...structuredClone(c.bosses[0]!), id: 'deep' });
    });
    killBoss(sim);
    nextLayer(sim);
    expect(reachBoss(sim).def).toBe('hive');
  });
});

describe('el esquema de los sectores', () => {
  const bad = (edit: (c: Content) => void) => {
    const c = structuredClone(DEFAULT_CONTENT);
    edit(c);
    return contentSchema.safeParse(c).success;
  };
  test('rechaza un Núcleo profundo inexistente, `every` < 2 y un bioma desconocido', () => {
    expect(bad((c) => (c.sectors[0]!.deepBoss = { boss: 'nope', every: 4 }))).toBe(false);
    expect(bad((c) => (c.sectors[0]!.deepBoss = { boss: 'hive', every: 1 }))).toBe(false);
    expect(bad((c) => ((c.sectors[0] as { biome: string }).biome = 'lava'))).toBe(false);
    expect(bad(() => {})).toBe(true);
  });
});

test('minas y saltos son deterministas: la misma semilla da el mismo hash', () => {
  const play = () => {
    const sim = withPattern({ kind: 'mines', count: 3, spread: 80, radius: 30, delay: 0.5, damage: 5 }, (c) => {
      c.bosses[0]!.phases[0]!.patterns.push({ kind: 'blink', offset: 90, windup: 0.4, count: 8, speed: 120, damage: 5 });
    });
    for (let t = 0; t < 600; t++) step(sim, [{ mx: t % 90 < 45 ? 1 : -1, my: t % 60 < 30 ? 1 : 0, aim: -1, pick: -1 }]);
    return stateHash(sim);
  };
  expect(play()).toBe(play());
});

// Nov plan B1: a Núcleo is as tough and as harmful as the sector, the season's anomaly and the group say.
describe('el Núcleo sigue los multiplicadores del sector, la anomalía y el grupo', () => {
  function bossWith(over: (c: Content) => void): Sim {
    const sim = quietSim((c) => {
      c.sectors[0]!.layerSeconds = 1;
      over(c);
    });
    for (let i = 0; i < 70 && !sim.boss; i++) step(sim, [IDLE]);
    return sim;
  }
  const bossDamage = (sim: Sim) => sim.enemies.damage[sim.boss!.index]!;
  const bossHp = (sim: Sim) => sim.enemies.maxHp[sim.boss!.index]!;

  test('el daño del sector multiplica el del Núcleo', () => {
    const base = bossWith(() => {});
    const harder = bossWith((c) => {
      c.sectors[0]!.enemyDamage = 1.5;
    });
    expect(bossDamage(harder)).toBeCloseTo(bossDamage(base) * 1.5);
  });

  test('la anomalía de la temporada endurece su vida y su daño', () => {
    const base = bossWith(() => {});
    const sim = quietSim(
      (c) => {
        c.sectors[0]!.layerSeconds = 1;
        c.anomalies.push({ ...c.anomalies[0]!, id: 'dura', enemyHp: 2, enemyDamage: 1.25 });
      },
      { anomaly: 'dura' },
    );
    for (let i = 0; i < 70 && !sim.boss; i++) step(sim, [IDLE]);
    expect(bossHp(sim)).toBeCloseTo(bossHp(base) * 2);
    expect(bossDamage(sim)).toBeCloseTo(bossDamage(base) * 1.25);
  });
});
