import { describe, expect, test } from 'vitest';
import {
  botInput,
  DEFAULT_COOP_RULES,
  decodeLog,
  encodeLog,
  gainXp,
  hurtProbe,
  IDLE,
  nextLayer,
  type ProbeInput,
  replay,
  scaleAt,
  type Sim,
  spawnPoint,
  stateHash,
  step,
} from '../src/index';
import { options, quietSim, run, tinyContent } from './fixtures';
import { createSim } from '../src/index';

// The co-op mode inside the run (multiplayer plan, phase 4): the world never pauses for cards, probes fall and are
// revived, out until the next layer, presence (away, back, left), scaling by players, spawns around each player, and
// a recorded co-op run replays to the same state.

const coop = DEFAULT_COOP_RULES;
const team = (n: number, over: Parameters<typeof quietSim>[0] = undefined): Sim => {
  const content = tinyContent(over);
  return createSim(options(content, { coop, probes: Array.from({ length: n }, () => ({ probe: content.probes[0]!.id, relics: [] })) }));
};
const idle = (sim: Sim): ProbeInput[] => sim.probes.map(() => ({ ...IDLE }));

describe('cartas sin pausa', () => {
  test('subir de nivel abre una oferta con plazo y el mundo sigue', () => {
    const sim = team(2);
    run(sim, 1);
    gainXp(sim, sim.probes[0]!, 10_000);
    const tick = sim.tick;
    run(sim, 1);
    const p = sim.probes[0]!;
    expect(sim.status).toBe('running');
    expect(sim.tick).toBe(tick + 1);
    expect(p.offer).not.toBeNull();
    expect(p.offerSeq).toBe(1);
    expect(p.offerUntil).toBe(sim.tick + coop.pickSeconds * 60);
    run(sim, 30);
    expect(sim.tick).toBe(tick + 31);
  });

  test('una carta que nombra la oferta abierta se toma; con otro número se ignora', () => {
    const sim = team(2);
    run(sim, 1);
    gainXp(sim, sim.probes[0]!, sim.probes[0]!.xpNext);
    run(sim, 1);
    const p = sim.probes[0]!;
    const before = p.weapons.length + p.passives.length + p.weapons.reduce((a, w) => a + w.level, 0);
    const wrong = idle(sim);
    wrong[0] = { ...IDLE, pick: 0, offer: (p.offerSeq + 1) & 255 };
    step(sim, wrong);
    expect(p.offer).not.toBeNull();
    const right = idle(sim);
    right[0] = { ...IDLE, pick: 0, offer: p.offerSeq & 255 };
    step(sim, right);
    expect(p.offer).toBeNull();
    expect(p.weapons.length + p.passives.length + p.weapons.reduce((a, w) => a + w.level, 0)).toBeGreaterThan(before);
  });

  test('si se acaba el tiempo, la carta se elige sola', () => {
    const sim = team(2);
    run(sim, 1);
    gainXp(sim, sim.probes[1]!, sim.probes[1]!.xpNext);
    run(sim, 1);
    const events: string[] = [];
    for (let k = 0; k < coop.pickSeconds * 60 + 2; k++) {
      step(sim, idle(sim));
      for (const e of sim.events) events.push(e.t);
    }
    expect(sim.probes[1]!.offer).toBeNull();
    expect(events).toContain('offerAuto');
  });
});

describe('caer y reanimar', () => {
  test('a 0 de vida cae, y un compañero a su lado lo levanta', () => {
    const sim = team(2);
    run(sim, 1);
    const [a, b] = sim.probes;
    hurtProbe(sim, a!, 1e9);
    expect(a!.life).toBe('down');
    expect(a!.alive).toBe(false);
    expect(sim.status).toBe('running');
    b!.x = a!.x + 10;
    b!.y = a!.y;
    run(sim, coop.reviveSeconds * 60 + 1);
    expect(a!.life).toBe('up');
    expect(a!.hp).toBeCloseTo(a!.stats.maxHp * coop.reviveHp, 5);
    expect(a!.invulnT).toBeGreaterThan(0);
    expect(b!.revives).toBe(1);
    expect(a!.downs).toBe(1);
  });

  test('solo y sin ayuda, queda fuera hasta la capa siguiente y entonces vuelve', () => {
    const sim = team(2);
    run(sim, 1);
    const [a, b] = sim.probes;
    hurtProbe(sim, a!, 1e9);
    b!.x = a!.x + 400;
    run(sim, coop.downSeconds * 60 + 2);
    expect(a!.life).toBe('out');
    nextLayer(sim);
    expect(a!.life).toBe('up');
    expect(sim.events.some((e) => e.t === 'probeBack')).toBe(true);
  });

  test('si caen todos, la incursión se acaba', () => {
    const sim = team(2);
    run(sim, 1);
    hurtProbe(sim, sim.probes[0]!, 1e9);
    hurtProbe(sim, sim.probes[1]!, 1e9);
    expect(sim.status).toBe('dead');
  });
});

describe('presencia', () => {
  test('ausente no recibe daño ni cuenta; al volver sigue donde estaba', () => {
    const sim = team(2);
    run(sim, 1);
    const inputs = idle(sim);
    inputs[0] = { ...IDLE, presence: 1 };
    step(sim, inputs);
    const a = sim.probes[0]!;
    expect(a.life).toBe('away');
    const hp = a.hp;
    hurtProbe(sim, a, 1e9);
    expect(a.hp).toBe(hp);
    inputs[0] = { ...IDLE, presence: 0 };
    step(sim, inputs);
    expect(a.life).toBe('up');
    expect(a.alive).toBe(true);
  });

  test('quien se va no vuelve, y la capa siguiente se escala sin él', () => {
    const sim = team(2);
    run(sim, 1);
    const inputs = idle(sim);
    inputs[1] = { ...IDLE, presence: 2 };
    step(sim, inputs);
    inputs[1] = { ...IDLE, presence: 0 };
    step(sim, inputs);
    expect(sim.probes[1]!.life).toBe('left');
    expect(sim.players).toBe(2);
    nextLayer(sim);
    expect(sim.players).toBe(1);
  });
});

describe('dificultad y aparición', () => {
  test('los enemigos aguantan más según los jugadores', () => {
    const solo = quietSim();
    const four = team(4);
    expect(scaleAt(four).hp / scaleAt(solo).hp).toBeCloseTo(coop.enemyHp[3]!, 5);
    expect(scaleAt(four).damage / scaleAt(solo).damage).toBeCloseTo(coop.enemyDamage[3]!, 5);
  });

  test('ningún enemigo aparece dentro de la vista de un jugador, aunque estén separados', () => {
    const sim = team(3);
    run(sim, 1);
    sim.probes[1]!.x = 2000;
    sim.probes[2]!.y = -1500;
    const { viewW, viewH } = sim.content.arena;
    for (let k = 0; k < 300; k++) {
      const p = spawnPoint(sim, sim.rng.spawn);
      for (const q of sim.probes) expect(Math.abs(q.x - p.x) < viewW / 2 && Math.abs(q.y - p.y) < viewH / 2).toBe(false);
    }
  });
});

describe('grabación', () => {
  test('una incursión en grupo grabada (cartas, caídas, ausencias) se repite igual', () => {
    const content = tinyContent((c) => {
      // Something to fight with and against, so kills, levels and picks happen.
      c.probes[0]!.weapon = 'pulse';
      c.probes[0]!.hp = 1_000_000;
      c.sectors[0]!.density = { ...c.sectors[0]!.density, base: 2, max: 2 };
      c.sectors[0]!.spawns = c.sectors[0]!.spawns.map((sp) => ({ ...sp, from: 0 }));
    });
    const opts = options(content, { coop, record: true, probes: [0, 1].map(() => ({ probe: content.probes[0]!.id, relics: [] })) });
    const sim = createSim(opts);
    let presence = 0;
    while (sim.tick < 3000 && sim.status === 'running') {
      const inputs = sim.probes.map((p) => {
        const input: ProbeInput = { ...botInput(sim, p.index), presence: p.index === 1 ? presence : 0 };
        if (p.offer && sim.tick % 37 === 0) return { ...input, pick: sim.tick % p.offer.length, offer: p.offerSeq & 255 };
        return input;
      });
      if (sim.tick === 800) presence = 1;
      if (sim.tick === 1400) presence = 0;
      step(sim, inputs);
    }
    const kinds = new Set<number>();
    for (let i = 2; i < sim.log!.events.length; i += 6) kinds.add(sim.log!.events[i]!);
    // Moves, picks while the world runs, presence and (SIM 1.12.0) the bots' dashes.
    expect([...kinds].sort()).toEqual([0, 2, 3, 4]);
    expect(sim.probes.some((p) => p.level >= 2)).toBe(true);
    const bytes = encodeLog(sim.log!);
    expect(bytes[0]).toBe(2);
    const again = replay({ ...opts, record: false }, decodeLog(bytes), sim.tick);
    expect(again.tick).toBe(sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });

  test('una incursión en solitario sigue grabándose con la versión 1', () => {
    const sim = quietSim(undefined, { record: true });
    run(sim, 120, { ...IDLE, mx: 127 });
    expect(encodeLog(sim.log!)[0]).toBe(1);
  });
});
