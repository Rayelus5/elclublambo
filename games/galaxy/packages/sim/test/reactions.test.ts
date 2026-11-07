import { describe, expect, test } from 'vitest';
import {
  botInput,
  botPick,
  createSim,
  dealDamage,
  DEFAULT_CONTENT,
  decodeLog,
  ELEMENT_IDS,
  type ElementId,
  encodeLog,
  refreshStats,
  type RelicInput,
  replay,
  type Sim,
  type SimEvent,
  type SimOptions,
  spawnBoss,
  spawnEnemy,
  stateHash,
  step,
} from '../src/index';
import { quietSim, run } from './fixtures';

// Reactions (GDD §5.4): an elemental hit leaves its mark; another element on a marked enemy sets off the pair's
// reaction (short circuit, thermal shock…). Reaction damage carries no element, so nothing chains forever, and every
// enemy waits a second between reactions (§8.6).

const code = (e: ElementId) => ELEMENT_IDS.indexOf(e) + 1;

function world(): Sim {
  const sim = quietSim((c) => {
    for (const e of c.enemies) {
      e.hp = 1000;
      e.xp = 0;
    }
    c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
  });
  sim.rng.combat.chance = () => false;
  return sim;
}
const at = (sim: Sim, x: number, y: number, id = 'dummy') => spawnEnemy(sim, sim.content.enemies.find((e) => e.id === id)!, x, y);
const hit = (sim: Sim, e: number, amount: number, element: ElementId | null) =>
  dealDamage(sim, e, amount, { probe: 0, weapon: null, relic: element ? 0 : null, element });
const lost = (sim: Sim, e: number) => 1000 - sim.enemies.hp[e]!;
const reactions = (sim: Sim): SimEvent[] => sim.events.filter((ev) => ev.t === 'reaction');

describe('marcas', () => {
  test('un golpe con elemento deja su marca 3 s; el mismo elemento la renueva', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    hit(sim, e, 10, 'burn');
    expect(sim.enemies.mark[e]).toBe(code('burn'));
    expect(sim.enemies.markT[e]).toBe(180);
    run(sim, 60);
    hit(sim, e, 10, 'burn');
    expect(sim.enemies.markT[e]).toBe(180);
  });

  test('sin pareja, el elemento nuevo sustituye la marca; con pareja reacciona y la consume', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    hit(sim, e, 10, 'leech');
    hit(sim, e, 10, 'slow');
    expect(sim.enemies.mark[e]).toBe(code('slow'));
    sim.events.length = 0;
    hit(sim, e, 10, 'burn');
    expect(reactions(sim)).toEqual([expect.objectContaining({ t: 'reaction', id: 'thermal-shock' })]);
    expect(sim.enemies.mark[e]).toBe(0);
  });

  test('puro e inversión no marcan; prisma reacciona como el elemento al que se resuelve', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    hit(sim, e, 10, 'pure');
    hit(sim, e, 10, 'invert');
    expect(sim.enemies.mark[e]).toBe(0);
    hit(sim, e, 10, 'prism');
    expect(sim.enemies.mark[e]).toBe(code(sim.content.elements.prism.cycle[0]!));
  });
});

describe('efectos', () => {
  test('cadena (Cortocircuito): corrosión y luego descarga dañan a 5 vecinos con el 80 % del golpe', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    const near = [at(sim, 340, 0), at(sim, 300, 40), at(sim, 260, 0), at(sim, 300, -40), at(sim, 380, 0), at(sim, 400, 0)];
    run(sim, 1); // neighbours come from the spatial grid, built during a step
    hit(sim, e, 10, 'corrosion');
    hit(sim, e, 10, 'shock');
    // The shock hit lands on a corroded enemy (+20 %): 12, and the chain carries 80 % of it.
    const hits = near.map((o) => lost(sim, o));
    expect(hits.filter((h) => Math.abs(h - 9.6) < 1e-9)).toHaveLength(5);
    expect(hits.filter((h) => h === 0)).toHaveLength(1);
  });

  test('explosión (Sobrecarga): quemadura y luego descarga dañan en un radio de 56', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    const inside = at(sim, 340, 0);
    const outside = at(sim, 380, 0);
    run(sim, 1);
    hit(sim, e, 10, 'burn');
    hit(sim, e, 10, 'shock');
    expect(lost(sim, inside)).toBe(10);
    expect(lost(sim, outside)).toBe(0);
  });

  test('rotura (Choque térmico): +40 % de daño recibido 4 s, sin frente blindado; otra no se apila', () => {
    const sim = world();
    const shell = at(sim, 300, 0, 'shell');
    sim.enemies.facing[shell] = 2048; // facing the probe at the origin: its armoured front takes the hits
    hit(sim, shell, 10, 'burn');
    hit(sim, shell, 10, 'slow');
    expect(sim.enemies.vulnBonus[shell]).toBeCloseTo(0.4, 9);
    expect(sim.enemies.vulnT[shell]).toBe(240);
    const before = lost(sim, shell);
    hit(sim, shell, 10, null);
    expect(lost(sim, shell) - before).toBeCloseTo(14, 9);
    run(sim, 61);
    hit(sim, shell, 10, 'breach');
    hit(sim, shell, 10, 'slow');
    expect(sim.enemies.vulnBonus[shell]).toBeCloseTo(0.5, 9);
    // The bigger bonus and the longer time: 0.5 against 0.4, 180 ticks against the 179 left.
    expect(sim.enemies.vulnT[shell]).toBe(180);
  });

  test('aturdimiento (Superconductor): detiene a un enemigo; al jefe, a ×0,25 y con sus patrones parados', () => {
    const sim = world();
    const mite = at(sim, 200, 0, 'mite');
    hit(sim, mite, 1, 'shock');
    hit(sim, mite, 1, 'slow');
    const x = sim.enemies.x[mite]!;
    run(sim, 60);
    expect(sim.enemies.x[mite]).toBe(x);
    spawnBoss(sim);
    const b = sim.boss!.index;
    hit(sim, b, 1, 'shock');
    hit(sim, b, 1, 'slow');
    expect(sim.enemies.freezeT[b]).toBe(18);
    const t = sim.boss!.t;
    run(sim, 10);
    expect(sim.boss!.t).toBe(t);
  });

  test('contagio (Ácido hirviente y Virus): copia estados a los vecinos; el hackeo nunca a jefes ni élites', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    const n1 = at(sim, 340, 0);
    const n2 = at(sim, 300, 50);
    run(sim, 1);
    hit(sim, e, 10, 'burn');
    hit(sim, e, 10, 'corrosion');
    for (const o of [n1, n2]) {
      expect(sim.enemies.burnT[o]).toBeGreaterThan(0);
      expect(sim.enemies.corrT[o]).toBeGreaterThan(0);
    }
    const v = world();
    const src = at(v, 300, 0);
    const plain = at(v, 330, 0);
    const elite = at(v, 300, 40);
    v.enemies.elite[elite] = 1;
    run(v, 61);
    hit(v, src, 10, 'hack');
    hit(v, src, 10, 'corrosion');
    expect(v.enemies.hackT[plain]).toBe(120);
    expect(v.enemies.hackT[elite]).toBe(0);
  });

  test('drenaje (Sangría): robo de vida y luego quemadura curan a la sonda el 25 % del golpe de la reacción', () => {
    const sim = world();
    const p = sim.probes[0]!;
    p.hp = 50;
    const e = at(sim, 300, 0);
    hit(sim, e, 10, 'leech');
    const hp = p.hp;
    hit(sim, e, 20, 'burn');
    expect(p.hp - hp).toBeCloseTo(20 * 0.25, 9);
  });
});

describe('frenos', () => {
  test('el daño de una reacción no lleva elemento: nunca reacciona de nuevo', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    const n = at(sim, 340, 0);
    run(sim, 1);
    hit(sim, n, 1, 'burn');
    sim.events.length = 0;
    hit(sim, e, 10, 'corrosion');
    hit(sim, e, 10, 'shock');
    expect(reactions(sim)).toHaveLength(1);
    expect(sim.enemies.mark[n]).toBe(code('burn'));
  });

  test('cada enemigo espera 1 s entre reacciones', () => {
    const sim = world();
    const e = at(sim, 300, 0);
    sim.events.length = 0;
    hit(sim, e, 10, 'burn');
    hit(sim, e, 10, 'slow');
    hit(sim, e, 10, 'burn');
    hit(sim, e, 10, 'slow');
    expect(reactions(sim)).toHaveLength(1);
    run(sim, 60);
    sim.events.length = 0;
    hit(sim, e, 10, 'burn');
    hit(sim, e, 10, 'slow');
    expect(reactions(sim)).toHaveLength(1);
  });

  test('el Catalizador sube el daño de las reacciones', () => {
    const sim = world();
    const p = sim.probes[0]!;
    p.passives.push({ id: 'catalyst', level: 5 });
    refreshStats(sim, p);
    const e = at(sim, 300, 0);
    const inside = at(sim, 340, 0);
    run(sim, 1);
    hit(sim, e, 10, 'burn');
    hit(sim, e, 10, 'shock');
    expect(lost(sim, inside)).toBeCloseTo(15, 9);
  });
});

describe('repetición', () => {
  test('una partida con reacciones se repite con el mismo hash', () => {
    // Two galaxy types (no Lineage set): stronger relics would kill before a second element lands.
    const relic = (palette: string, n: number, type: string): RelicInput => ({ id: 'r' + n, seed: String(n), tier: 4, level: 1, traits: { galaxy_type: type, palette, size: 'large' } });
    // Tough fauna (×10 life): enemies live long enough to take a second element, so reactions are sure to happen.
    const content = structuredClone(DEFAULT_CONTENT);
    for (const e of content.enemies) e.hp *= 10;
    const opts: SimOptions = {
      seed: '9090',
      content,
      sector: 'outer-nebula',
      probes: [{ probe: 'lumen', relics: [relic('solar_gold', 1, 'ring'), relic('ultraviolet', 2, 'spiral')] }],
      record: true,
    };
    const sim = createSim(opts);
    let seen = 0;
    while (sim.tick < 5000 && (sim.status === 'running' || sim.status === 'choosing')) {
      if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(sim.probes[0]!.offer!) }]);
      else step(sim, [botInput(sim, 0)]);
      seen += sim.events.filter((ev) => ev.t === 'reaction').length;
    }
    expect(seen).toBeGreaterThan(0);
    const again = replay({ ...opts, record: false }, decodeLog(encodeLog(sim.log!)), sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });
});

describe('jefes y reacciones (revisión final)', () => {
  test('un jefe se aturde como mucho una vez cada 6 s', () => {
    const sim = world();
    spawnBoss(sim);
    const b = sim.boss!.index;
    const stun = () => {
      hit(sim, b, 1, 'shock');
      hit(sim, b, 1, 'slow');
    };
    stun();
    expect(sim.enemies.freezeT[b]).toBe(18);
    run(sim, 70);
    expect(sim.enemies.freezeT[b]).toBe(0);
    stun();
    expect(sim.enemies.freezeT[b]).toBe(0);
    run(sim, 6 * 60);
    stun();
    expect(sim.enemies.freezeT[b]).toBe(18);
  });

  test('el hackeo no marca a jefes ni élites (no se les puede hackear)', () => {
    const sim = world();
    spawnBoss(sim);
    const b = sim.boss!.index;
    hit(sim, b, 1, 'hack');
    expect(sim.enemies.mark[b]).toBe(0);
    const elite = at(sim, 300, 0);
    sim.enemies.elite[elite] = 1;
    hit(sim, elite, 1, 'hack');
    expect(sim.enemies.mark[elite]).toBe(0);
  });
});
