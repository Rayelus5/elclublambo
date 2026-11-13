import { describe, expect, test } from 'vitest';
import {
  type Content,
  createSim,
  decodeEvents,
  decodeLog,
  DEFAULT_CONTENT,
  DASH,
  encodeEvents,
  encodeLog,
  hudSnapshot,
  hurtProbe,
  IDLE,
  type ProbeInput,
  type RelicInput,
  replay,
  type Sim,
  spawnEnemy,
  stateHash,
  step,
} from '../src/index';
import { move, options, quietSim, run, tinyContent } from './fixtures';

// The dash is the player's (the owner, 2026-11-13: «no sea algo que ocurre con el tiempo, sino por decisión del
// jugador»): SHIFT, Space or the pad's A. Every probe has it; Spark's quirk and each comet relic improve it. Charges
// come back one at a time; two dashes need a short pause between them.

const D = DEFAULT_CONTENT.dash;
const STEPS = Math.round(D.seconds * 60);
const dash = (input: ProbeInput = IDLE, angle = -1): ProbeInput => ({ ...input, dash: angle });
const SPARK = { kind: 'dash', invuln: 0.3, charges: 1, recharge: 4, pause: 0.3 } as const;
const spark = (over?: (c: Content) => void) =>
  quietSim((c) => {
    c.probes[0]!.quirk = { ...SPARK };
    over?.(c);
  });
const comet = (n: number): RelicInput[] =>
  Array.from({ length: n }, (_, k) => ({
    id: 'c' + k,
    seed: '1',
    tier: 0,
    level: 1,
    traits: { galaxy_type: 'elliptical', size: 'medium', core: 'bright', star_density: 'normal', palette: 'monochrome', background: 'deep_void', phenomenon: 'comet', inclination: 'face_on' },
  }));
const sturdy = (sim: Sim, x: number, y: number) => {
  const e = spawnEnemy(sim, sim.content.enemies.find((d) => d.id === 'dummy')!, x, y);
  sim.enemies.hp[e] = sim.enemies.maxHp[e] = 1000;
  return e;
};

describe('el dash lo decides tú', () => {
  test('cada sonda tiene una carga: recorre su distancia hacia donde se mueve, en su tiempo, y la gasta', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    expect(p.dash.charges).toBe(1);
    step(sim, [dash(move(127, 0))]);
    // It moved its 1 unit this tick, then dashed from there along +x.
    expect(sim.events.find((e) => e.t === 'dash')).toEqual({ t: 'dash', probe: 0, kind: 'player', fx: 1, fy: 0, tx: 1 + D.distance, ty: 0, ticks: STEPS });
    expect(p.dash.charges).toBe(0);
    run(sim, STEPS - 1);
    expect(p.x).toBeCloseTo(1 + D.distance, 6);
    expect(p.y).toBeCloseTo(0, 6);
    // Over: still from here on.
    run(sim, 20);
    expect(p.x).toBeCloseTo(1 + D.distance, 6);
  });

  test('quieta va hacia el ratón (el ángulo de la pulsación) o hacia donde apunta; sin ninguno, hacia donde miraba', () => {
    const toMouse = quietSim();
    step(toMouse, [dash(IDLE, 1024)]);
    run(toMouse, STEPS);
    expect(toMouse.probes[0]!.x).toBeCloseTo(0, 6);
    expect(toMouse.probes[0]!.y).toBeCloseTo(D.distance, 6);

    const aimed = quietSim();
    step(aimed, [{ ...IDLE, aim: 3072, dash: -1 }]);
    run(aimed, STEPS);
    expect(aimed.probes[0]!.y).toBeCloseTo(-D.distance, 6);

    const facing = quietSim();
    step(facing, [move(-127, 0)]);
    step(facing, [dash()]);
    run(facing, STEPS);
    expect(facing.probes[0]!.x).toBeCloseTo(-1 - D.distance, 6);

    // Moving, the movement wins over the mouse.
    const moving = quietSim();
    step(moving, [dash(move(0, 127), 0)]);
    run(moving, STEPS);
    expect(moving.probes[0]!.x).toBeCloseTo(0, 6);
    expect(moving.probes[0]!.y).toBeCloseTo(1 + D.distance, 6);
  });

  test('invulnerable mientras dura y un poco más', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    step(sim, [dash(move(127, 0))]);
    hurtProbe(sim, p, 20);
    expect(p.hp).toBe(100);
    run(sim, STEPS + Math.round(D.invuln * 60));
    hurtProbe(sim, p, 20);
    expect(p.hp).toBe(80);
  });

  test('la carga vuelve tras su recarga, más rápido con enfriamiento', () => {
    const sim = quietSim();
    const p = sim.probes[0]!;
    p.stats.cooldown = 0.5;
    step(sim, [dash(move(127, 0))]);
    const back = Math.round(D.recharge * 0.5 * 60);
    run(sim, back - 1);
    expect(p.dash.charges).toBe(0);
    run(sim, 1);
    expect(p.dash.charges).toBe(1);
    // Full: it does not go past its charges.
    run(sim, back * 3);
    expect(p.dash.charges).toBe(1);
  });

  test('pide una pausa entre dos dashes aunque queden cargas, y no gasta la pulsación rechazada', () => {
    const sim = spark();
    const p = sim.probes[0]!;
    expect(p.dash.charges).toBe(2);
    step(sim, [dash(move(127, 0))]);
    step(sim, [dash(move(127, 0))]);
    expect(p.dash.charges).toBe(1);
    run(sim, Math.round(SPARK.pause * 60) - 1, move(127, 0));
    step(sim, [dash(move(127, 0))]);
    expect(p.dash.charges).toBe(0);
  });

  test('Chispa: dos cargas que vuelven antes, una a una, y más invulnerabilidad; ya no esquiva sola', () => {
    const sim = spark();
    const p = sim.probes[0]!;
    hurtProbe(sim, p, 20);
    expect(p.hp).toBe(80);
    step(sim, [dash(move(127, 0))]);
    run(sim, Math.round(SPARK.pause * 60));
    step(sim, [dash(move(127, 0))]);
    expect(p.dash.charges).toBe(0);
    // Its longer invulnerability: still safe a little after the base one would have ended.
    run(sim, STEPS + Math.round(D.invuln * 60) + 2);
    hurtProbe(sim, p, 20);
    expect(p.hp).toBe(80);
    run(sim, Math.round(SPARK.recharge * 60) - Math.round(SPARK.pause * 60) - STEPS - Math.round(D.invuln * 60) - 4);
    expect(p.dash.charges).toBe(0);
    run(sim, Math.round(SPARK.pause * 60) + 2);
    expect(p.dash.charges).toBe(1);
    run(sim, Math.round(SPARK.recharge * 60));
    expect(p.dash.charges).toBe(2);
  });

  test('cada reliquia Cometa suma una carga, hasta dos', () => {
    for (const [n, max] of [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 3],
    ] as const) {
      const sim = quietSim(undefined, { probes: [{ probe: 'lumen', relics: comet(n) }] });
      expect(sim.probes[0]!.dash.charges).toBe(max);
      expect(hudSnapshot(sim, 0).dash.max).toBe(max);
    }
  });

  test('con un Cometa el dash daña una vez lo que atraviesa; sin él, no; y el Cometa ya no embiste solo', () => {
    const withComet = quietSim(undefined, { probes: [{ probe: 'lumen', relics: comet(1) }] });
    withComet.rng.combat.chance = () => false;
    const e = sturdy(withComet, 45, 0);
    step(withComet, [dash(move(127, 0))]);
    expect(withComet.events.find((x) => x.t === 'dash')).toMatchObject({ kind: 'comet' });
    run(withComet, STEPS + 10);
    expect(1000 - withComet.enemies.hp[e]!).toBe(DEFAULT_CONTENT.relics.phenomena.comet.damage);

    const plain = quietSim();
    const f = sturdy(plain, 45, 0);
    step(plain, [dash(move(127, 0))]);
    run(plain, STEPS + 10);
    expect(plain.enemies.hp[f]).toBe(1000);

    const moving = quietSim(undefined, { probes: [{ probe: 'lumen', relics: comet(1) }] });
    run(moving, 600, move(127, 0));
    expect(moving.probes[0]!.x).toBeCloseTo(600, 6);
  });

  test('no hay dash con una mejora por elegir, ni estando caída', () => {
    const choosing = quietSim();
    const p = choosing.probes[0]!;
    p.offer = [{ kind: 'heal', id: 'heal', level: 1 }];
    p.pendingLevels = 1;
    choosing.status = 'choosing';
    step(choosing, [dash(move(127, 0))]);
    expect(p.dash.charges).toBe(1);
    expect(p.x).toBe(0);

    const dead = quietSim();
    dead.probes[0]!.alive = false;
    step(dead, [dash(move(127, 0))]);
    expect(dead.probes[0]!.dash.charges).toBe(1);
  });

  test('el HUD sabe sus cargas, su recarga y su pausa', () => {
    const sim = quietSim();
    expect(hudSnapshot(sim, 0).dash).toEqual({ charges: 1, max: 1, recharge: 0, rechargeTotal: D.recharge, pause: 0, pauseTotal: D.pause });
    step(sim, [dash(move(127, 0))]);
    const h = hudSnapshot(sim, 0).dash;
    expect(h.charges).toBe(0);
    expect(h.recharge).toBeCloseTo(D.recharge, 1);
    expect(h.pause).toBeCloseTo(D.pause, 1);
  });
});

describe('el dash en las repeticiones', () => {
  function played(): { sim: Sim; opts: ReturnType<typeof options> } {
    // A charge back every second, so the run has a few dashes.
    const opts = { ...options(tinyContent((c) => (c.dash.recharge = 1))), record: true };
    const sim = createSim(opts);
    for (let t = 0; t < 400; t++) {
      const m = t < 120 ? move(127, 0) : t < 240 ? move(0, -127) : IDLE;
      step(sim, [t === 10 || t === 150 ? dash(m) : t === 300 ? dash(m, 512) : t === 301 ? dash(m) : m]);
    }
    return { sim, opts };
  }

  test('se graba cada dash aceptado con su ángulo y la partida se repite igual', () => {
    const { sim, opts } = played();
    const dashes: number[][] = [];
    const ev = sim.log!.events;
    for (let i = 0; i < ev.length; i += 6) if (ev[i + 2] === DASH) dashes.push(ev.slice(i, i + 6));
    // The one at 301 came within the pause (and with no charge): not a dash, not in the log.
    expect(dashes).toEqual([
      [11, 0, DASH, -1, 0, 0],
      [151, 0, DASH, -1, 0, 0],
      [301, 0, DASH, 512, 0, 0],
    ]);
    const log = decodeLog(encodeLog(sim.log!));
    expect(log.events).toEqual(sim.log!.events);
    // A solo log with dashes is still a solo log (version 1).
    expect(encodeLog(sim.log!)[0]).toBe(1);
    const again = replay(opts, log, sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });

  test('las piezas en directo admiten el dash', () => {
    const { sim } = played();
    const { bytes, tick } = encodeEvents(sim.log!.events, 0);
    const back = decodeEvents(bytes, 0, 1);
    expect(back.events).toEqual(sim.log!.events);
    expect(back.tick).toBe(tick);
  });
});
