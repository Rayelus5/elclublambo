import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  activeLaser,
  angleDiff,
  angleTo,
  bossIdAt,
  type BossPattern,
  type Content,
  contentSchema,
  cosA,
  dealDamage,
  DEFAULT_CONTENT,
  degToSteps,
  IDLE,
  nextLayer,
  PROBE_RADIUS,
  type SectorDef,
  type Sim,
  type SimEvent,
  sinA,
  stateHash,
  step,
  ticks,
} from '../src/index';
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

// Nov plan B4: every Núcleo has three forms that take turns layer by layer; the deep Core's layers do not count for the
// sector's turn, and the deep Core turns by how many times it has come.
describe('formas del Núcleo por capa', () => {
  const sector = (over: Partial<SectorDef>): SectorDef => ({ ...structuredClone(DEFAULT_CONTENT.sectors[0]!), ...over });
  const firstLayers = (s: SectorDef, n: number) => Array.from({ length: n }, (_, i) => bossIdAt(s, i + 1));

  test('con Núcleo profundo cada 4 capas: 1, 2, 3, profundo y vuelta a empezar; el profundo rota por apariciones', () => {
    const s = sector({ boss: 'a', bossCycle: ['a', 'b', 'c'], deepBoss: { boss: 'd1', every: 4, cycle: ['d1', 'd2', 'd3'] } });
    expect(firstLayers(s, 16)).toEqual(['a', 'b', 'c', 'd1', 'a', 'b', 'c', 'd2', 'a', 'b', 'c', 'd3', 'a', 'b', 'c', 'd1']);
  });

  test('la forma de la capa L es ((L − 1) − ⌊(L − 1) / every⌋) mod 3 con cualquier `every`', () => {
    for (const every of [2, 3, 4, 5]) {
      const s = sector({ boss: 'a', bossCycle: ['a', 'b', 'c'], deepBoss: { boss: 'd', every } });
      for (let L = 1; L <= 40; L++) {
        const want = L % every === 0 ? 'd' : ['a', 'b', 'c'][(L - 1 - Math.floor((L - 1) / every)) % 3];
        expect(bossIdAt(s, L), `every ${every}, capa ${L}`).toBe(want);
      }
    }
  });

  test('sin Núcleo profundo (la Fisura de la Señal) las formas rotan en todas las capas', () => {
    const rift = DEFAULT_CONTENT.sectors.find((s) => s.id === 'signal-rift')!;
    expect(rift.deepBoss).toBeNull();
    const [one, two, three] = rift.bossCycle!;
    expect(one).toBe(rift.boss);
    expect(firstLayers(rift, 7)).toEqual([one, two, three, one, two, three, one]);
  });

  test('el contenido por defecto: cada sector con 3 formas distintas que empiezan por su `boss`, y el Eco Profundo con 3', () => {
    for (const s of DEFAULT_CONTENT.sectors) {
      expect(s.bossCycle, s.id).toHaveLength(3);
      expect(s.bossCycle![0], s.id).toBe(s.boss);
      expect(new Set(s.bossCycle).size, s.id).toBe(3);
      if (s.deepBoss) expect(s.deepBoss.cycle, s.id).toEqual(['echo-core', 'echo-choir', 'echo-mirror']);
    }
    const ids = new Set(DEFAULT_CONTENT.bosses.map((b) => b.id));
    for (const s of DEFAULT_CONTENT.sectors) for (const id of [...s.bossCycle!, ...(s.deepBoss?.cycle ?? [])]) expect(ids.has(id), id).toBe(true);
  });

  test('un sector sin `bossCycle` ni ciclo profundo juega como antes: siempre su Núcleo y el profundo en sus capas', () => {
    const s = sector({ boss: 'hive', bossCycle: undefined, deepBoss: { boss: 'echo-core', every: 4 } });
    expect(firstLayers(s, 9)).toEqual(['hive', 'hive', 'hive', 'echo-core', 'hive', 'hive', 'hive', 'echo-core', 'hive']);
  });

  test('el contenido publicado (2026-11-10) sigue valiendo y trae un solo Núcleo por sector, como antes', () => {
    const live = JSON.parse(readFileSync(new URL('../../../ops/launch/2026-11-10/content.json', import.meta.url), 'utf8'));
    const parsed = contentSchema.safeParse(live);
    expect(parsed.success, JSON.stringify(parsed.error?.issues?.slice(0, 3))).toBe(true);
    for (const s of parsed.data!.sectors) {
      expect(s.bossCycle, s.id).toBeUndefined();
      for (let L = 1; L <= 12; L++) {
        const deep = s.deepBoss && L % s.deepBoss.every === 0;
        expect(bossIdAt(s, L), `${s.id} capa ${L}`).toBe(deep ? s.deepBoss!.boss : s.boss);
      }
    }
  });

  test('en partida: cada capa trae su forma, con su vida, y la fuerza sigue creciendo por capa', () => {
    const sim = withPattern({ kind: 'radial', count: 4, speed: 100, damage: 1 }, (c) => {
      c.sectors[0]!.bossCycle = ['hive', 'glacier', 'anemone'];
      c.sectors[0]!.deepBoss = { boss: 'echo-core', every: 4, cycle: ['echo-core', 'anvil', 'signal'] };
    });
    const seen: { boss: string; layer: number; hp: number }[] = [];
    for (let layer = 1; layer <= 9; layer++) {
      for (let i = 0; i < 200 && !sim.boss; i++) step(sim, [IDLE]);
      const b = sim.boss!;
      seen.push({ boss: b.def, layer: sim.layer, hp: sim.enemies.maxHp[b.index]! });
      dealDamage(sim, b.index, 1e12, src);
      nextLayer(sim);
    }
    expect(seen.map((s) => s.boss)).toEqual(['hive', 'glacier', 'anemone', 'echo-core', 'hive', 'glacier', 'anemone', 'anvil', 'hive']);
    for (const s of seen) {
      const def = sim.content.bosses.find((b) => b.id === s.boss)!;
      expect(s.hp, `${s.boss} capa ${s.layer}`).toBeCloseTo(def.hp * (1 + def.scaling.hpPerLayer * (s.layer - 1)), 6);
    }
  });

  test('el esquema rechaza formas que no existen y un ciclo que no empieza por su Núcleo', () => {
    const ok = (edit: (c: Content) => void) => {
      const c = structuredClone(DEFAULT_CONTENT);
      edit(c);
      return contentSchema.safeParse(c).success;
    };
    expect(ok(() => {})).toBe(true);
    expect(ok((c) => (c.sectors[0]!.bossCycle = ['hive', 'nope']))).toBe(false);
    expect(ok((c) => (c.sectors[0]!.bossCycle = ['glacier', 'hive']))).toBe(false);
    expect(ok((c) => (c.sectors[0]!.bossCycle = []))).toBe(false);
    expect(ok((c) => (c.sectors[0]!.deepBoss = { boss: 'echo-core', every: 4, cycle: ['echo-core', 'nope'] }))).toBe(false);
    expect(ok((c) => (c.sectors[0]!.deepBoss = { boss: 'echo-core', every: 4, cycle: ['hive'] }))).toBe(false);
    expect(ok((c) => delete c.sectors[0]!.bossCycle)).toBe(true);
  });
});

const telegraphs = (sim: Sim, kind: string) => sim.events.filter((e): e is Extract<SimEvent, { t: 'telegraph' }> => e.t === 'telegraph' && e.kind === kind);
/** Puts the probe at `d` u from (x, y) along angle step `a`. */
function place(sim: Sim, x: number, y: number, a: number, d: number): void {
  const p = sim.probes[0]!;
  p.x = x + cosA(a) * d;
  p.y = y + sinA(a) * d;
  p.px = p.x;
  p.py = p.y;
}
/** Steps `n` ticks and says whether the probe lost life. */
function hurtWithin(sim: Sim, n: number): boolean {
  const p = sim.probes[0]!;
  const hp = p.hp;
  for (let t = 0; t < n; t++) step(sim, [IDLE]);
  return p.hp < hp;
}

// Nov plan B4: three new attacks, each announced before it hurts.
describe('patrones de las formas nuevas', () => {
  const laser = (over: Partial<Extract<BossPattern, { kind: 'laser' }>> = {}): BossPattern => ({ kind: 'laser', windup: 0.5, duration: 1, sweep: 0, length: 400, width: 12, damage: 10, ...over });

  test('laser: avisa con una línea hacia la sonda y no quema durante el aviso', () => {
    const sim = withPattern(laser());
    const b = sim.boss!;
    untilFired(sim, (s) => telegraphs(s, 'laser').length > 0);
    const tel = telegraphs(sim, 'laser')[0]!;
    const p = sim.probes[0]!;
    expect(tel.radius).toBe(400);
    expect(tel.ticks).toBe(ticks(0.5));
    expect(Math.abs(angleDiff(tel.angle, angleTo(p.x - sim.enemies.x[b.index]!, p.y - sim.enemies.y[b.index]!)))).toBeLessThanOrEqual(2);
    expect(hurtWithin(sim, ticks(0.5) - 1)).toBe(false);
    expect(activeLaser(sim)).toBeNull();
    expect(hurtWithin(sim, 3)).toBe(true);
    expect(activeLaser(sim)).toMatchObject({ length: 400, width: 12 });
  });

  test('laser: quema a lo largo de su segmento y no fuera de él', () => {
    const at = (where: (sim: Sim, bx: number, by: number, a: number) => void): boolean => {
      const sim = withPattern(laser({ windup: 0.3 }));
      untilFired(sim, (s) => telegraphs(s, 'laser').length > 0);
      const tel = telegraphs(sim, 'laser')[0]!;
      where(sim, tel.x, tel.y, tel.angle);
      return hurtWithin(sim, ticks(0.3) + ticks(0.8));
    };
    const side = 6 + PROBE_RADIUS + 3;
    expect(at((sim, x, y, a) => place(sim, x, y, a, 150))).toBe(true);
    expect(at((sim, x, y, a) => place(sim, x, y, a, 390))).toBe(true);
    expect(at((sim, x, y, a) => place(sim, x + cosA(a + 1024) * side, y + sinA(a + 1024) * side, a, 150))).toBe(false);
    expect(at((sim, x, y, a) => place(sim, x, y, a, 400 + PROBE_RADIUS + 8))).toBe(false);
    expect(at((sim, x, y, a) => place(sim, x, y, a + 2048, 100))).toBe(false);
  });

  test('laser: gira los grados de `sweep` hacia el lado que anuncia, y lo de detrás de la línea queda a salvo', () => {
    const sweep = degToSteps(90);
    const sim = withPattern(laser({ windup: 0.3, duration: 1, sweep: 90 }));
    untilFired(sim, (s) => telegraphs(s, 'laser').length > 0);
    const tel = telegraphs(sim, 'laser')[0]!;
    expect(Math.abs(tel.arc ?? 0)).toBe(sweep);
    const turn = Math.sign(tel.arc!);
    // Ahead of the turn, at 3/4 of it: the beam comes there.
    place(sim, tel.x, tel.y, tel.angle + turn * Math.round(sweep * 0.75), 160);
    let last = tel.angle;
    let hurt = false;
    const p = sim.probes[0]!;
    const hp = p.hp;
    for (let t = 0; t < ticks(0.3) + ticks(1) + 2; t++) {
      step(sim, [IDLE]);
      const l = activeLaser(sim);
      if (l) last = l.angle;
      hurt ||= p.hp < hp;
    }
    expect(hurt).toBe(true);
    expect(Math.abs(angleDiff(tel.angle, last) - tel.arc!)).toBeLessThanOrEqual(Math.ceil(sweep / ticks(1)) + 1);
    // Behind the line it starts on (the other side of the turn), nothing burns.
    const safe = withPattern(laser({ windup: 0.3, duration: 1, sweep: 90 }));
    untilFired(safe, (s) => telegraphs(s, 'laser').length > 0);
    const st = telegraphs(safe, 'laser')[0]!;
    place(safe, st.x, st.y, st.angle - Math.sign(st.arc!) * degToSteps(30), 160);
    expect(hurtWithin(safe, ticks(0.3) + ticks(1) + 2)).toBe(false);
  });

  test('laser: un Núcleo aturdido durante el aviso no dispara el haz', () => {
    const sim = withPattern(laser({ windup: 0.5 }));
    const b = sim.boss!;
    untilFired(sim, (s) => telegraphs(s, 'laser').length > 0);
    sim.enemies.freezeT[b.index] = 5;
    step(sim, [IDLE]);
    expect(sim.boss!.active).toBeNull();
    expect(activeLaser(sim)).toBeNull();
  });

  const closing: BossPattern = { kind: 'closing', count: 24, radius: 120, gap: 60, delay: 0.5, speed: 60, damage: 10 };

  test('closing: avisa con un anillo alrededor de la sonda y las balas salen al acabar el aviso, cerrándose hacia dentro', () => {
    const sim = withPattern(closing);
    untilFired(sim, (s) => telegraphs(s, 'closing').length > 0);
    const tel = telegraphs(sim, 'closing')[0]!;
    const p = sim.probes[0]!;
    expect([tel.x, tel.y]).toEqual([p.x, p.y]);
    expect(tel.radius).toBe(120);
    expect(tel.arc).toBe(degToSteps(60));
    expect(tel.ticks).toBe(ticks(0.5));
    for (let t = 0; t < ticks(0.5) - 1; t++) {
      step(sim, [IDLE]);
      expect(bullets(sim)).toHaveLength(0);
    }
    untilFired(sim, (s) => bullets(s).length > 0);
    const ring = bullets(sim);
    expect(ring.length).toBeLessThan(24);
    expect(ring.length).toBeGreaterThanOrEqual(18);
    const fs = sim.foeShots;
    for (const i of ring) {
      const dx = fs.x[i]! - tel.x;
      const dy = fs.y[i]! - tel.y;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(110);
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(120 + 1e-6);
      // Moving inwards: its velocity points at the centre.
      expect(fs.vx[i]! * dx + fs.vy[i]! * dy).toBeLessThan(0);
    }
    const angles = ring.map((i) => angleTo(fs.x[i]! - tel.x, fs.y[i]! - tel.y)).sort((a, b) => a - b);
    const gaps = angles.map((a, k) => (k === 0 ? a + 4096 - angles[angles.length - 1]! : a - angles[k - 1]!));
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(degToSteps(60) * 0.95);
    // The bullets die at the centre: the ring never opens out again on the other side.
    const keys = bulletKeys(sim);
    for (let t = 0; t < ticks(120 / 60) + 2; t++) step(sim, [IDLE]);
    expect([...bulletKeys(sim)].filter((k) => keys.has(k))).toHaveLength(0);
  });

  test('closing: el hueco es seguro y el lado contrario no', () => {
    const play = (side: number) => {
      const sim = withPattern(closing);
      untilFired(sim, (s) => telegraphs(s, 'closing').length > 0);
      const tel = telegraphs(sim, 'closing')[0]!;
      place(sim, tel.x, tel.y, tel.angle + side, 60);
      return hurtWithin(sim, ticks(0.5) + ticks(120 / 60) + 2);
    };
    expect(play(0)).toBe(false);
    expect(play(2048)).toBe(true);
  });

  const barrage: BossPattern = { kind: 'barrage', count: 5, spacing: 40, radius: 18, delay: 0.5, step: 0.2, damage: 10 };

  test('barrage: marca una línea de círculos hacia la sonda, cada uno con su aviso, que estallan uno tras otro', () => {
    const sim = withPattern(barrage);
    const b = sim.boss!;
    untilFired(sim, (s) => s.blasts.length > 0);
    const bx = sim.enemies.x[b.index]!;
    const by = sim.enemies.y[b.index]!;
    const p = sim.probes[0]!;
    const aim = angleTo(p.x - bx, p.y - by);
    expect(sim.blasts).toHaveLength(5);
    const tels = telegraphs(sim, 'explode');
    expect(tels.map((t) => t.ticks)).toEqual([0, 1, 2, 3, 4].map((k) => ticks(0.5) + k * ticks(0.2)));
    sim.blasts.forEach((m, k) => {
      expect(Math.hypot(m.x - bx, m.y - by)).toBeCloseTo(40 * (k + 1), 0);
      expect(Math.abs(angleDiff(aim, angleTo(m.x - bx, m.y - by)))).toBeLessThanOrEqual(2);
      expect(m.radius).toBe(18);
    });
    const order: number[] = [];
    const at: number[] = [];
    const where = sim.blasts.map((m) => [m.x, m.y]);
    for (let t = 0; t < ticks(0.5) + 5 * ticks(0.2) + 2; t++) {
      step(sim, [IDLE]);
      for (const e of sim.events) {
        const k = e.t === 'blast' ? where.findIndex(([x, y]) => x === e.x && y === e.y) : -1;
        // Only this barrage (the next one may already be falling).
        if (k < 0) continue;
        order.push(k);
        at.push(sim.tick);
      }
    }
    expect(order).toEqual([0, 1, 2, 3, 4]);
    for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!).toBe(ticks(0.2));
  });

  test('barrage: hiere en su círculo al estallar, no antes ni fuera', () => {
    const sim = withPattern(barrage);
    untilFired(sim, (s) => s.blasts.length > 0);
    const third = sim.blasts[2]!;
    place(sim, third.x, third.y, 0, 0);
    expect(hurtWithin(sim, third.at - sim.tick - 1)).toBe(false);
    expect(hurtWithin(sim, 2)).toBe(true);

    const away = withPattern(barrage);
    untilFired(away, (s) => s.blasts.length > 0);
    const m = away.blasts[2]!;
    // Beside the line, just out of its reach (the circles are 40 u apart along it).
    const along = angleTo(m.x - away.blasts[0]!.x, m.y - away.blasts[0]!.y);
    place(away, m.x, m.y, along + 1024, 18 + PROBE_RADIUS + 3);
    expect(hurtWithin(away, ticks(0.5) + 5 * ticks(0.2) + 2)).toBe(false);
  });

  test('el daño de los tres sigue la capa y la dureza del sector', () => {
    const hurtBy = (pattern: BossPattern, enemyDamage: number) => {
      const sim = withPattern(pattern, (c) => (c.sectors[0]!.enemyDamage = enemyDamage));
      untilFired(sim, (s) => s.events.some((e) => e.t === 'telegraph' && e.kind !== 'burst'));
      const tel = sim.events.find((e): e is Extract<SimEvent, { t: 'telegraph' }> => e.t === 'telegraph' && e.kind !== 'burst')!;
      if (pattern.kind === 'laser') place(sim, tel.x, tel.y, tel.angle, 120);
      else if (pattern.kind === 'barrage') place(sim, sim.blasts[0]!.x, sim.blasts[0]!.y, 0, 0);
      else place(sim, tel.x, tel.y, tel.angle + 2048, 60);
      const p = sim.probes[0]!;
      const hp = p.hp;
      for (let t = 0; t < 4 * 60 && p.hp === hp; t++) step(sim, [IDLE]);
      return hp - p.hp;
    };
    for (const pattern of [laser(), closing, barrage]) {
      expect(hurtBy(pattern, 1), pattern.kind).toBeCloseTo(10, 6);
      expect(hurtBy(pattern, 1.5), pattern.kind).toBeCloseTo(15, 6);
    }
  });

  test('los tres son deterministas: la misma semilla da el mismo hash', () => {
    const play = () => {
      const sim = withPattern(laser({ sweep: 70 }), (c) => {
        c.bosses[0]!.phases[0]!.patterns.push(closing, barrage);
      });
      for (let t = 0; t < 900; t++) step(sim, [{ mx: t % 90 < 45 ? 1 : -1, my: t % 60 < 30 ? 1 : 0, aim: -1, pick: -1 }]);
      return stateHash(sim);
    };
    expect(play()).toBe(play());
  });
});
