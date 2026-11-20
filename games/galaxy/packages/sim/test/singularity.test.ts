import { describe, expect, test } from 'vitest';
import {
  AREA,
  botInput,
  botPick,
  contentSchema,
  createSim,
  DEFAULT_CONTENT,
  DEFAULT_COOP_RULES,
  dropPickup,
  hurtProbe,
  IDLE,
  PICKUP,
  type RelicInput,
  relicSkill,
  type Sim,
  type SimEvent,
  spawnEnemy,
  stateHash,
  step,
  ticks,
} from '../src/index';
import { options, quietSim, run, tinyContent } from './fixtures';

// Plan «rareza Mítica» M2 (the owner's ruling): a mythic galaxy equipped as a relic has its own power, «Singularidad».
// Every so often a small black hole opens on the densest group of fauna near the probe, pulls it in for a moment and
// collapses with damage that grows with the relic's magnitude. One at a time per probe; never the Núcleo, never the loot.

const C = DEFAULT_CONTENT;
const S = C.relics.singularity;
const relic = (traits: Record<string, string>, tier = 0, level = 1, id?: string): RelicInput => ({
  id: id ?? 'r' + Object.values(traits).join('-') + tier,
  seed: '1',
  tier,
  level,
  traits: { galaxy_type: 'elliptical', size: 'medium', core: 'bright', star_density: 'normal', palette: 'monochrome', background: 'deep_void', phenomenon: 'none', ...traits },
});
const mythic = (traits: Record<string, string> = {}, id?: string) => relic(traits, 5, 1, id);

/** A quiet world with these relics equipped, sturdy still targets and no criticals. */
function equipped(...relics: RelicInput[]): Sim {
  const sim = quietSim(
    (c) => {
      for (const e of c.enemies) e.hp = 1000;
      c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
    },
    { probes: [{ probe: 'lumen', relics }] },
  );
  sim.rng.combat.chance = () => false;
  return sim;
}
const target = (sim: Sim, x: number, y: number) => spawnEnemy(sim, sim.content.enemies.find((e) => e.id === 'dummy')!, x, y);
const lost = (sim: Sim, e: number) => 1000 - sim.enemies.hp[e]!;
const holes = (sim: Sim) => {
  const out: number[] = [];
  for (let i = 0; i < sim.areas.top; i++) if (sim.areas.alive[i] && sim.areas.kind[i] === AREA.singularity) out.push(i);
  return out;
};
const opened = (events: readonly SimEvent[]) => events.filter((e) => e.t === 'singularity' && e.what === 'open').length;

describe('Singularidad: el poder propio de las míticas (M2)', () => {
  test('solo una mítica la tiene: una legendaria no', () => {
    expect(relicSkill(mythic(), [mythic()], C).mythic).toBe(true);
    const legendary = relic({}, 4);
    expect(relicSkill(legendary, [legendary], C).mythic).toBe(false);
    const sim = equipped(legendary);
    target(sim, 100, 0);
    target(sim, 105, 5);
    run(sim, 120);
    expect(holes(sim)).toHaveLength(0);
  });

  test('se abre en el grupo de fauna más denso a su alcance, no en el enemigo más cercano', () => {
    const sim = equipped(mythic());
    target(sim, 90, 0);
    for (const [x, y] of [
      [-150, 60],
      [-140, 70],
      [-160, 50],
      [-145, 45],
    ] as const)
      target(sim, x, y);
    step(sim, [IDLE]);
    expect(opened(sim.events)).toBe(1);
    const [h] = holes(sim);
    expect(h).toBeDefined();
    expect(Math.hypot(sim.areas.x[h!]! + 149, sim.areas.y[h!]! - 56)).toBeLessThan(12);
  });

  test('sin fauna a su alcance no se abre; en cuanto llega, sí', () => {
    const sim = equipped(mythic());
    target(sim, S.seek + 200, 0);
    run(sim, 120);
    expect(holes(sim)).toHaveLength(0);
    target(sim, 80, 0);
    step(sim, [IDLE]);
    expect(holes(sim)).toHaveLength(1);
  });

  test('atrae a la fauna cercana hacia su centro, pero nunca al Núcleo ni al botín', () => {
    const sim = equipped(mythic());
    for (const [x, y] of [
      [150, 0],
      [155, 5],
      [145, -5],
    ] as const)
      target(sim, x, y);
    const pulled = target(sim, 220, 40);
    const core = target(sim, 190, -60);
    sim.enemies.boss[core] = 1;
    dropPickup(sim, PICKUP.coin, 1, 180, 50);
    const coin = sim.pickups.top - 1;
    step(sim, [IDLE]);
    const [h] = holes(sim);
    const cx = sim.areas.x[h!]!;
    const cy = sim.areas.y[h!]!;
    const dist = () => Math.hypot(sim.enemies.x[pulled]! - cx, sim.enemies.y[pulled]! - cy);
    const before = dist();
    run(sim, 60);
    expect(dist()).toBeLessThan(before - 40);
    expect(sim.enemies.x[core]).toBe(190);
    expect(sim.enemies.y[core]).toBe(-60);
    expect(sim.pickups.alive[coin]).toBe(1);
    expect(sim.pickups.x[coin]).toBe(180);
    expect(sim.pickups.y[coin]).toBe(50);
  });

  test('al colapsar lanza hacia fuera a la fauna que reunió, pero no al Núcleo', () => {
    const sim = equipped(mythic());
    const group = [target(sim, 150, 0), target(sim, 170, 30), target(sim, 130, -30), target(sim, 160, -40)];
    const core = target(sim, 140, 35);
    sim.enemies.boss[core] = 1;
    step(sim, [IDLE]);
    const [h] = holes(sim);
    const cx = sim.areas.x[h!]!;
    const cy = sim.areas.y[h!]!;
    const spread = () => Math.max(...group.map((e) => Math.hypot(sim.enemies.x[e]! - cx, sim.enemies.y[e]! - cy)));
    run(sim, ticks(S.seconds) - 1);
    const gathered = spread();
    expect(gathered).toBeLessThan(20);
    run(sim, 40);
    expect(spread()).toBeGreaterThan(gathered + S.push * 0.6);
    expect(sim.enemies.x[core]).toBe(140);
    expect(sim.enemies.y[core]).toBe(35);
  });

  test('colapsa a su tiempo con un daño en área que crece con la magnitud de la reliquia', () => {
    const blast = (r: RelicInput) => {
      const sim = equipped(r);
      const group = [target(sim, 100, 0), target(sim, 105, 5), target(sim, 95, -5)];
      const far = target(sim, -200, 0);
      step(sim, [IDLE]);
      run(sim, ticks(S.seconds) - 1);
      expect(group.map((e) => lost(sim, e))).toEqual([0, 0, 0]);
      expect(holes(sim)).toHaveLength(1);
      step(sim, [IDLE]);
      expect(sim.events.some((e) => e.t === 'singularity' && e.what === 'collapse')).toBe(true);
      expect(holes(sim)).toHaveLength(0);
      expect(lost(sim, far)).toBe(0);
      return group.map((e) => lost(sim, e));
    };
    // A plain mythic: magnitude 1.9 (tier 6).
    for (const d of blast(mythic())) expect(d).toBeCloseTo(S.damage * 1.9, 9);
    // A colossal one hits ×1.3 harder.
    for (const d of blast(mythic({ size: 'colossal' }))) expect(d).toBeCloseTo(S.damage * 1.9 * 1.3, 9);
  });

  test(`una cada ${S.cooldown} s`, () => {
    const sim = equipped(mythic());
    target(sim, 100, 0);
    target(sim, 105, 5);
    let n = 0;
    for (let t = 0; t < ticks(S.cooldown) * 2 + 1; t++) {
      step(sim, [IDLE]);
      n += opened(sim.events);
    }
    expect(n).toBe(3);
  });

  test('una sola por sonda: con dos míticas no se abre más a menudo, y golpea con la más fuerte', () => {
    const sim = equipped(mythic({}, 'm1'), mythic({ galaxy_type: 'dwarf', size: 'colossal' }, 'm2'));
    const group = [target(sim, 100, 0), target(sim, 105, 5), target(sim, 95, -5)];
    let n = 0;
    let most = 0;
    for (let t = 0; t < ticks(15); t++) {
      step(sim, [IDLE]);
      n += opened(sim.events);
      most = Math.max(most, holes(sim).length);
      // The first collapse (at 2 s) with the colossal one's magnitude (1.9 × 1.3).
      if (t === ticks(S.seconds)) for (const e of group) expect(lost(sim, e)).toBeCloseTo(S.damage * 1.9 * 1.3, 9);
    }
    expect(most).toBe(1);
    // At 0 s and at 12 s, as with one.
    expect(n).toBe(2);
  });

  // Review of PR #180: a hole on a probe's own position pulled the fauna onto it.
  test('nunca se abre encima de una sonda: con la fauna en corro a su alrededor no se abre, y busca un grupo lejos de ella', () => {
    const sim = equipped(mythic());
    const ring = (cx: number, cy: number) => {
      for (let k = 0; k < 12; k++) target(sim, cx + Math.round(Math.cos((k * Math.PI) / 6) * 45), cy + Math.round(Math.sin((k * Math.PI) / 6) * 45));
    };
    ring(0, 0);
    const p = sim.probes[0]!;
    run(sim, 150);
    expect(holes(sim)).toHaveLength(0);
    expect(p.hp).toBe(100);
    // A smaller group far enough off: it opens there.
    for (const [x, y] of [
      [200, 0],
      [210, 10],
      [190, -10],
    ] as const)
      target(sim, x, y);
    step(sim, [IDLE]);
    const [h] = holes(sim);
    expect(h).toBeDefined();
    expect(Math.hypot(sim.areas.x[h!]! - p.x, sim.areas.y[h!]! - p.y)).toBeGreaterThanOrEqual(S.clear);
  });

  test('en grupo, tampoco se abre encima de un compañero rodeado', () => {
    const content = tinyContent((c) => {
      for (const e of c.enemies) e.hp = 1000;
      c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
    });
    const sim = createSim(options(content, { coop: DEFAULT_COOP_RULES, probes: [{ probe: content.probes[0]!.id, relics: [mythic()] }, { probe: content.probes[0]!.id, relics: [] }] }));
    sim.rng.combat.chance = () => false;
    const [me, mate] = sim.probes;
    me!.x = me!.px = 0;
    me!.y = me!.py = 0;
    mate!.x = mate!.px = 180;
    mate!.y = mate!.py = 0;
    for (let k = 0; k < 12; k++) target(sim, 180 + Math.round(Math.cos((k * Math.PI) / 6) * 45), Math.round(Math.sin((k * Math.PI) / 6) * 45));
    for (let t = 0; t < 150; t++) {
      step(sim, [IDLE, IDLE]);
      for (const h of holes(sim)) {
        for (const q of sim.probes) expect(Math.hypot(sim.areas.x[h]! - q.x, sim.areas.y[h]! - q.y)).toBeGreaterThanOrEqual(S.clear);
      }
    }
    expect(holes(sim)).toHaveLength(0);
    expect(mate!.hp).toBe(mate!.stats.maxHp);
  });

  test('si su sonda cae con una abierta, colapsa en ese momento y no se queda tirando', () => {
    const content = tinyContent((c) => {
      for (const e of c.enemies) e.hp = 1000;
      c.enemies.find((e) => e.id === 'dummy')!.speed = 0;
    });
    const sim = createSim(options(content, { coop: DEFAULT_COOP_RULES, probes: [{ probe: content.probes[0]!.id, relics: [mythic()] }, { probe: content.probes[0]!.id, relics: [] }] }));
    sim.rng.combat.chance = () => false;
    const [me, mate] = sim.probes;
    me!.x = me!.px = 0;
    me!.y = me!.py = 0;
    mate!.x = mate!.px = -300;
    mate!.y = mate!.py = 0;
    const group = [target(sim, 150, 0), target(sim, 160, 10), target(sim, 140, -10)];
    step(sim, [IDLE, IDLE]);
    expect(holes(sim)).toHaveLength(1);
    run(sim, 20);
    hurtProbe(sim, me!, 1e6);
    expect(me!.life).toBe('down');
    let collapsed = false;
    step(sim, [IDLE, IDLE]);
    collapsed ||= sim.events.some((e) => e.t === 'singularity' && e.what === 'collapse');
    expect(collapsed).toBe(true);
    expect(holes(sim)).toHaveLength(0);
    for (const e of group) expect(lost(sim, e)).toBeGreaterThan(0);
  });

  test('con las áreas llenas no se abre y no vuelve a buscar en cada tic: espera medio segundo', () => {
    const sim = equipped(mythic());
    target(sim, 100, 0);
    target(sim, 105, 5);
    const a = sim.areas;
    const filler: number[] = [];
    for (let i = a.spawn(); i >= 0; i = a.spawn()) {
      a.ttl[i] = 1e9;
      a.kind[i] = AREA.trail;
      a.radius[i] = 1;
      a.damage[i] = 0;
      a.pull[i] = 0;
      a.slow[i] = 0;
      a.x[i] = a.y[i] = 5000;
      filler.push(i);
    }
    step(sim, [IDLE]);
    expect(holes(sim)).toHaveLength(0);
    a.kill(filler[0]!);
    run(sim, 28);
    expect(holes(sim)).toHaveLength(0);
    run(sim, 2);
    expect(holes(sim)).toHaveLength(1);
  });

  test('es determinista: la misma partida con míticas da el mismo estado', () => {
    const play = () => {
      const sim = createSim({ seed: '2026111302', content: C, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [mythic({}, 'a'), mythic({ galaxy_type: 'ring' }, 'b')] }] });
      let n = 0;
      while (sim.tick < 90 * 60 && (sim.status === 'running' || sim.status === 'choosing')) {
        const p = sim.probes[0]!;
        if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(p.offer!) }]);
        else step(sim, [botInput(sim, 0, 99)]);
        n += opened(sim.events);
      }
      return { hash: stateHash(sim), n };
    };
    const a = play();
    expect(a.n).toBeGreaterThan(2);
    expect(play()).toEqual(a);
  }, 60_000);

  test('el contenido publicado antes de la Singularidad sigue valiendo y toma sus valores por defecto', () => {
    const { singularity: _gone, ...old } = C.relics;
    const parsed = contentSchema.parse({ ...C, relics: old });
    expect(parsed.relics.singularity).toEqual(S);
  });
});
