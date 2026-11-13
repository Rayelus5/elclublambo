import { describe, expect, test } from 'vitest';
import {
  botInput,
  botPick,
  type Content,
  contentSchema,
  createSim,
  dealDamage,
  DEFAULT_CONTENT,
  decodeLog,
  dropPickup,
  encodeLog,
  hurtProbe,
  IDLE,
  replay,
  type Sim,
  type SimOptions,
  spawnEnemy,
  stateHash,
  step,
} from '../src/index';
import { quietSim, run } from './fixtures';

// Probes (GDD §6): each one has a quirk of its own. The numbers are data; what each quirk does is code.

type Quirk = NonNullable<Content['probes'][number]['quirk']>;
const withQuirk = (quirk: Quirk, over?: (c: Content) => void): Sim =>
  quietSim((c) => {
    c.probes[0]!.quirk = quirk;
    for (const e of c.enemies) e.xp = 0;
    over?.(c);
  });
const dummy = (sim: Sim) => sim.content.enemies.find((e) => e.id === 'dummy')!;
const pickupsOf = (sim: Sim, kind: number) => {
  const out: number[] = [];
  for (let i = 0; i < sim.pickups.top; i++) if (sim.pickups.alive[i] && sim.pickups.kind[i] === kind) out.push(i);
  return out;
};

describe('peculiaridades', () => {
  test('imán: cada 30 s atrae los fragmentos a su alcance, y no los de más allá', () => {
    const sim = withQuirk({ kind: 'magnet', every: 30, radius: 240 });
    for (let k = 0; k < 3; k++) dropPickup(sim, 0, 1, 150 + k * 20, 0);
    dropPickup(sim, 0, 1, 600, 0);
    const near = pickupsOf(sim, 0).slice(0, 3);
    const far = pickupsOf(sim, 0)[3]!;
    run(sim, 30 * 60 - 10);
    expect(near.every((i) => sim.pickups.magnet[i] === 0)).toBe(true);
    run(sim, 20);
    expect(near.every((i) => sim.pickups.magnet[i] === 1)).toBe(true);
    expect(sim.pickups.magnet[far]).toBe(0);
  });

  test('espinas: devuelve parte del daño de contacto a quien toca', () => {
    const sim = withQuirk({ kind: 'thorns', share: 0.6 }, (c) => (dummy({ content: c } as Sim).hp = 100));
    const e = spawnEnemy(sim, dummy(sim), 4, 0);
    run(sim, 2);
    expect(100 - sim.enemies.hp[e]!).toBeCloseTo(6, 9);
  });

  test('vigilancia: un dron más con un arma de drones', () => {
    const sim = withQuirk({ kind: 'overwatch', drones: 1 });
    sim.probes[0]!.weapons = [{ id: 'drone', level: 1, t: 0 }];
    run(sim, 2);
    let drones = 0;
    for (let i = 0; i < sim.shots.top; i++) if (sim.shots.alive[i] && sim.shots.kind[i] === 5) drones++;
    expect(drones).toBe(2);
  });

  test('segundo aliento: al caer vuelve con el 30 % de la vida, una sola vez', () => {
    const sim = withQuirk({ kind: 'second-wind', hp: 0.3 });
    const p = sim.probes[0]!;
    hurtProbe(sim, p, 500);
    expect(p.alive).toBe(true);
    expect(p.hp).toBeCloseTo(30, 9);
    run(sim, 200);
    hurtProbe(sim, p, 500);
    expect(p.alive).toBe(false);
    expect(sim.status).toBe('dead');
  });

  test('toque prismático: los golpes de arma aplican elementos que rotan', () => {
    const sim = withQuirk({ kind: 'prism-touch', chance: 1, cycle: ['burn', 'slow'] }, (c) => (dummy({ content: c } as Sim).hp = 1e6));
    sim.rng.combat.chance = (q: number) => q >= 1;
    const e = spawnEnemy(sim, dummy(sim), 300, 0);
    const seen: string[] = [];
    for (let k = 0; k < 4; k++) {
      sim.events.length = 0;
      dealDamage(sim, e, 1, { probe: 0, weapon: 'pulse', relic: null, element: null });
      const ev = sim.events.find((x) => x.t === 'hit');
      seen.push(ev && ev.t === 'hit' ? String(ev.element) : '');
    }
    expect(seen).toEqual(['burn', 'slow', 'burn', 'slow']);
  });

  test('postcombustión: tras cada baja, más velocidad durante 2 s', () => {
    const sim = withQuirk({ kind: 'afterburner', bonus: 0.2, seconds: 2 });
    const p = sim.probes[0]!;
    const base = p.stats.speed;
    dealDamage(sim, spawnEnemy(sim, dummy(sim), 300, 0), 1e6, { probe: 0, weapon: 'pulse', relic: null, element: null });
    run(sim, 1);
    expect(p.stats.speed).toBeGreaterThan(base * 1.15);
    run(sim, 2 * 60 + 5);
    expect(p.stats.speed).toBeCloseTo(base, 9);
  });

  test('chatarrero: cada 30 bajas suelta un kit de reparación', () => {
    const sim = withQuirk({ kind: 'salvage', kills: 30 });
    for (let k = 0; k < 29; k++) dealDamage(sim, spawnEnemy(sim, dummy(sim), 300, 0), 1e6, { probe: 0, weapon: 'pulse', relic: null, element: null });
    expect(pickupsOf(sim, 3)).toHaveLength(0);
    dealDamage(sim, spawnEnemy(sim, dummy(sim), 300, 0), 1e6, { probe: 0, weapon: 'pulse', relic: null, element: null });
    expect(pickupsOf(sim, 3)).toHaveLength(1);
  });
});

describe('las 8 sondas', () => {
  test('el contenido trae las 8 sondas con su peculiaridad, 3 iniciales entre ellas', () => {
    expect(DEFAULT_CONTENT.probes.map((p) => p.id)).toEqual(['lumen', 'bastion', 'spark', 'sentinel', 'anchor', 'prism', 'comet', 'echo']);
    for (const p of DEFAULT_CONTENT.probes) expect(p.quirk, p.id).not.toBeNull();
  });

  test('una peculiaridad desconocida no se acepta', () => {
    const c = structuredClone(DEFAULT_CONTENT);
    (c.probes[0] as { quirk: unknown }).quirk = { kind: 'teleport' };
    expect(() => contentSchema.parse(c)).toThrow();
  });

  test.each(DEFAULT_CONTENT.probes.map((p) => p.id))('una partida de bot con %s se repite con el mismo hash', (probe) => {
    const opts: SimOptions = { seed: '8080', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe, relics: [] }], record: true };
    const sim = createSim(opts);
    while (sim.tick < 4000 && (sim.status === 'running' || sim.status === 'choosing')) {
      if (sim.status === 'choosing') step(sim, [{ ...IDLE, pick: botPick(sim.probes[0]!.offer!) }]);
      else step(sim, [botInput(sim, 0)]);
    }
    const again = replay({ ...opts, record: false }, decodeLog(encodeLog(sim.log!)), sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });
});
