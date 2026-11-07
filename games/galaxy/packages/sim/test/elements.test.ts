import { describe, expect, test } from 'vitest';
import { dealDamage, type ElementId, fireFoeBullet, IDLE, invertNearby, refreshStats, type RelicInput, SHOT, type Sim, spawnEnemy, step } from '../src/index';
import { quietSim, run } from './fixtures';

// Elements (GDD §5.4, §8.3): each relic palette gives an element. Its hits apply it, and weapon hits apply the relics'
// elements now and then (15 %, taking turns).

const species = (sim: Sim, id: string) => sim.content.enemies.find((e) => e.id === id)!;
/** Targets with life 1000 and no movement unless asked. */
function world(): Sim {
  const sim = quietSim((c) => {
    for (const e of c.enemies) e.hp = 1000;
    c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
  });
  force(sim, () => false);
  return sim;
}
/** Combat rolls answer `yes(p)` (p: the probability asked). */
function force(sim: Sim, yes: (p: number) => boolean): void {
  sim.rng.combat.chance = (p: number) => yes(p);
}
const at = (sim: Sim, x: number, y: number, id = 'dummy') => spawnEnemy(sim, species(sim, id), x, y);
const hit = (sim: Sim, e: number, amount: number, element: ElementId | null, extra: { weapon?: string; x?: number; y?: number } = {}) =>
  dealDamage(sim, e, amount, { probe: 0, weapon: extra.weapon ?? null, relic: element ? 0 : null, element, x: extra.x, y: extra.y });
const lost = (sim: Sim, e: number) => 1000 - sim.enemies.hp[e]!;

describe('estados', () => {
  test('quemadura: 25 % del golpe por segundo durante 3 s, hasta 3 cargas', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    hit(sim, e, 20, 'burn');
    run(sim, 60);
    expect(lost(sim, e)).toBeCloseTo(20 + 5, 6);
    for (let k = 0; k < 4; k++) hit(sim, e, 20, 'burn');
    const before = lost(sim, e);
    run(sim, 60);
    expect(sim.enemies.burnStacks[e]).toBe(3);
    expect(lost(sim, e) - before).toBeCloseTo(15, 6);
    run(sim, 3 * 60);
    const after = lost(sim, e);
    run(sim, 60);
    expect(lost(sim, e)).toBe(after);
  });

  test('ralentización: un 35 % más lento durante 2 s', () => {
    const sim = world();
    const slow = at(sim, 300, 0, 'mite');
    const free = at(sim, -300, 0, 'mite');
    hit(sim, slow, 1, 'slow');
    run(sim, 60);
    expect(300 - sim.enemies.x[slow]!).toBeCloseTo(62 * 0.65, 1);
    expect(sim.enemies.x[free]! + 300).toBeCloseTo(62, 1);
    run(sim, 61);
    const x = sim.enemies.x[slow]!;
    run(sim, 60);
    expect(x - sim.enemies.x[slow]!).toBeCloseTo(62, 1);
  });

  test('corrosión: +20 % de daño recibido y atraviesa el frente blindado', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    hit(sim, e, 10, 'corrosion');
    hit(sim, e, 10, null);
    expect(lost(sim, e)).toBeCloseTo(10 + 12, 9);
    const shell = at(sim, 100, 0, 'shell');
    hit(sim, shell, 10, 'corrosion', { x: 0, y: 0 });
    hit(sim, shell, 10, null, { x: 0, y: 0 });
    // The first frontal hit is armoured (×0.25) and corrodes; the second goes through the front, +20 %.
    expect(lost(sim, shell)).toBeCloseTo(2.5 + 12, 9);
  });

  test('descarga: salta a 2 enemigos cercanos con la mitad', () => {
    const sim = world();
    force(sim, (p) => p === 0.25);
    const a = at(sim, 300, 0);
    const b = at(sim, 340, 0);
    const c = at(sim, 300, 50);
    const far = at(sim, 600, 0);
    step(sim, [IDLE]); // neighbours are found through the spatial grid, built every tick
    hit(sim, a, 20, 'shock');
    expect([lost(sim, a), lost(sim, b), lost(sim, c), lost(sim, far)]).toEqual([20, 10, 10, 0]);
  });

  test('hackeo: el enemigo lucha a tu favor 5 s y no te hace daño; jefes y élites no se hackean', () => {
    const sim = world();
    force(sim, (p) => p === 0.08);
    const traitor = at(sim, 20, 0, 'mite');
    const foe = at(sim, 120, 0);
    hit(sim, traitor, 1, 'hack');
    expect(sim.enemies.hackT[traitor]).toBe(300);
    run(sim, 120);
    expect(sim.probes[0]!.hp).toBe(100);
    expect(lost(sim, foe)).toBeGreaterThan(0);
    const elite = spawnEnemy(sim, species(sim, 'mite'), 400, 0, { elite: sim.content.elites[1]! });
    hit(sim, elite, 1, 'hack');
    expect(sim.enemies.hackT[elite]).toBe(0);
  });

  test('robo de vida: cura el 4 % del daño', () => {
    const sim = world();
    sim.probes[0]!.hp = 50;
    hit(sim, at(sim, 300, 0), 100, 'leech');
    expect(sim.probes[0]!.hp).toBeCloseTo(54, 9);
  });

  test('daño a escudos: ×2,5 contra el escudo de una élite y +50 % contra blindados', () => {
    const sim = world();
    const shielded = spawnEnemy(sim, species(sim, 'mite'), 300, 0, { elite: sim.content.elites[0]! });
    const shield = sim.enemies.shield[shielded]!;
    hit(sim, shielded, 4, 'breach');
    expect(shield - sim.enemies.shield[shielded]!).toBeCloseTo(10, 9);
    const shell = at(sim, 100, 0, 'shell');
    hit(sim, shell, 10, 'breach', { x: 200, y: 0 });
    expect(lost(sim, shell)).toBeCloseTo(15, 9);
  });

  test('rebotes: un salto más al más cercano con el 70 %', () => {
    const sim = world();
    const a = at(sim, 300, 0);
    const b = at(sim, 360, 0);
    const c = at(sim, 380, 0);
    step(sim, [IDLE]);
    hit(sim, a, 10, 'chain');
    expect([lost(sim, a), lost(sim, b), lost(sim, c)]).toEqual([10, 7, 0]);
  });

  test('daño puro: +15 % de crítico y críticos de ×2', () => {
    const sim = world();
    force(sim, (p) => Math.abs(p - 0.2) < 1e-9);
    const e = at(sim, 300, 0);
    hit(sim, e, 10, 'pure');
    expect(lost(sim, e)).toBeCloseTo(20, 9);
  });

  test('prisma: cada golpe aplica el siguiente de quemadura, ralentización, corrosión y descarga', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    const seen: (ElementId | null)[] = [];
    for (let k = 0; k < 5; k++) {
      hit(sim, e, 1, 'prism');
      // The hit's own event comes first; a reaction may add its own hits after it.
      const ev = sim.events.find((x) => x.t === 'hit');
      seen.push(ev && ev.t === 'hit' ? ev.element : null);
      sim.events.length = 0;
    }
    expect(seen).toEqual(['burn', 'slow', 'corrosion', 'shock', 'burn']);
  });

  test('inversión: una bala que entra a 50 u vuelve con el doble de daño; cada bala se tira una vez', () => {
    const sim = world();
    force(sim, (p) => p === 0.4);
    fireFoeBullet(sim, 45, 0, 2048, 120, 9);
    invertNearby(sim, sim.probes[0]!);
    expect(sim.foeShots.count).toBe(0);
    let reflected = -1;
    for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === SHOT.reflected) reflected = i;
    expect(reflected).toBeGreaterThanOrEqual(0);
    expect(sim.shots.damage[reflected]).toBe(18);
    expect(sim.shots.vx[reflected]).toBeGreaterThan(0);

    const unlucky = world();
    fireFoeBullet(unlucky, 45, 0, 2048, 120, 9);
    invertNearby(unlucky, unlucky.probes[0]!);
    force(unlucky, () => true);
    invertNearby(unlucky, unlucky.probes[0]!);
    expect(unlucky.foeShots.count).toBe(1);
  });
});

describe('elementos en los golpes de las armas', () => {
  const relic = (palette: string): RelicInput => ({ id: palette, seed: '1', tier: 0, level: 1, traits: { galaxy_type: 'dwarf', palette } });

  test('un 15 % de los golpes aplica el elemento de una reliquia, por turnos', () => {
    const sim = quietSim(
      (c) => {
        for (const e of c.enemies) e.hp = 1000;
      },
      { probes: [{ probe: 'lumen', relics: [relic('solar_gold'), relic('andromeda_blue')] }] },
    );
    force(sim, (p) => p === 0.15);
    const e = at(sim, 300, 0);
    const seen: (ElementId | null)[] = [];
    for (let k = 0; k < 4; k++) {
      sim.events.length = 0;
      hit(sim, e, 1, null, { weapon: 'pulse' });
      // The hit's own event comes first; a reaction may add its own hits after it.
      const ev = sim.events.find((x) => x.t === 'hit');
      seen.push(ev && ev.t === 'hit' ? ev.element : null);
    }
    expect(seen).toEqual(['burn', 'slow', 'burn', 'slow']);
    force(sim, () => false);
    hit(sim, e, 1, null, { weapon: 'pulse' });
    const last = sim.events.filter((x) => x.t === 'hit').at(-1);
    expect(last && last.t === 'hit' ? last.element : 'x').toBeNull();
    step(sim, [IDLE]);
  });
});

describe('Catalizador (potencia elemental)', () => {
  const catalysed = (level: number) => {
    const sim = world();
    const p = sim.probes[0]!;
    if (level > 0) {
      p.passives.push({ id: 'catalyst', level });
      refreshStats(sim, p);
    }
    return sim;
  };

  test('sube la probabilidad de aplicar el elemento de las reliquias a los golpes de arma', () => {
    const asked: number[] = [];
    const sim = quietSim((c) => (c.enemies.find((e) => e.id === 'dummy')!.hp = 1e6), {
      probes: [{ probe: 'lumen', relics: [{ id: 'r', seed: '1', tier: 0, level: 1, traits: { galaxy_type: 'dwarf', palette: 'solar_gold' } }] }],
    });
    const p = sim.probes[0]!;
    p.passives.push({ id: 'catalyst', level: 5 });
    refreshStats(sim, p);
    force(sim, (q) => {
      asked.push(q);
      return false;
    });
    hit(sim, at(sim, 300, 0), 10, null, { weapon: 'pulse' });
    expect(asked).toContain(0.15 * 1.5);
  });

  test('alarga la quemadura, la ralentización, la corrosión y el hackeo', () => {
    const plain = catalysed(0);
    const strong = catalysed(5);
    for (const sim of [plain, strong]) {
      force(sim, () => true);
      sim.content.elements.hack.chance = 1;
    }
    const lasting = (sim: Sim) => {
      const out: number[] = [];
      for (const el of ['burn', 'slow', 'corrosion'] as const) {
        const e = at(sim, 300, 0);
        hit(sim, e, 10, el);
        out.push(el === 'burn' ? sim.enemies.burnT[e]! : el === 'slow' ? sim.enemies.slowT[e]! : sim.enemies.corrT[e]!);
      }
      const h = at(sim, 300, 0);
      hit(sim, h, 10, 'hack');
      out.push(sim.enemies.hackT[h]!);
      return out;
    };
    const base = lasting(plain);
    expect(base).toEqual([180, 120, 240, 300]);
    expect(lasting(strong)).toEqual(base.map((t) => Math.round(t * 1.5)));
  });
});
