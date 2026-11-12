import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  botInput,
  botPick,
  createLiveReplayer,
  createReplayer,
  createSim,
  DEFAULT_CONTENT,
  decodeEvents,
  decodeLog,
  encodeEvents,
  encodeLog,
  fromBase64,
  type InputLog,
  replay,
  type Sim,
  type SimOptions,
  stateHash,
  step,
  toBase64,
} from '../src/index';

// Recorded runs (GDD §5.7, §14.7): the inputs of every run are kept compactly, so a run can be replayed exactly —
// to check it against cheating later, and to add network co-op without rewriting the simulation.

const opts = (probes = 1, seed = '20261107'): SimOptions => ({
  seed,
  content: DEFAULT_CONTENT,
  sector: 'outer-nebula',
  probes: Array.from({ length: probes }, () => ({ probe: 'lumen', relics: [] })),
  record: true,
});

/** Plays `ticks` world ticks with the bot (choosing level-ups as they come). */
function play(sim: Sim, ticks: number): void {
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') {
      step(
        sim,
        sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? botPick(p.offer) : -1 })),
      );
    } else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
  }
}

describe('codificación', () => {
  const logArb = fc
    .integer({ min: 1, max: 4 })
    .chain((probes) =>
      fc
        .array(
          fc.oneof(
            fc.tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: probes - 1 }), fc.constant(0), fc.integer({ min: -127, max: 127 }), fc.integer({ min: -127, max: 127 }), fc.integer({ min: -1, max: 4095 })),
            fc.tuple(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 0, max: probes - 1 }), fc.constant(1), fc.integer({ min: 0, max: 2 }), fc.constant(0), fc.constant(0)),
          ),
          { maxLength: 60 },
        )
        .map((evs) => {
          let tick = 0;
          const events: number[] = [];
          for (const [dt, p, kind, a, b, c] of evs) {
            tick += dt;
            events.push(tick, p, kind, a, b, c);
          }
          return { probes, events } satisfies InputLog;
        }),
    );

  test('codificar y decodificar devuelve lo mismo', () => {
    fc.assert(
      fc.property(logArb, (log) => {
        const back = decodeLog(encodeLog(log));
        return back.probes === log.probes && JSON.stringify(back.events) === JSON.stringify(log.events);
      }),
      { numRuns: 300 },
    );
  });

  test('bytes basura o truncados → bad_log', () => {
    expect(() => decodeLog(new Uint8Array([]))).toThrow('bad_log');
    expect(() => decodeLog(new Uint8Array([9, 1]))).toThrow('bad_log');
    const good = encodeLog({ probes: 1, events: [5, 0, 0, 10, -10, 200, 9, 0, 1, 2, 0, 0] });
    expect(() => decodeLog(good.slice(0, good.length - 1))).toThrow('bad_log');
    expect(() => decodeLog(encodeLog({ probes: 1, events: [5, 3, 0, 0, 0, -1] }))).toThrow('bad_log');
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), (bytes) => {
        try {
          decodeLog(bytes);
          return true;
        } catch (e) {
          return e instanceof RangeError && e.message === 'bad_log';
        }
      }),
      { numRuns: 300 },
    );
  });

  test('base64 sin Buffer, en los dos sentidos, y rechaza lo que no lo es', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (bytes) => {
        const s = toBase64(bytes);
        return /^[A-Za-z0-9+/]*={0,2}$/.test(s) && Buffer.from(bytes).toString('base64') === s && fromBase64(s).join(',') === bytes.join(',');
      }),
      { numRuns: 200 },
    );
    expect(() => fromBase64('no es base64!')).toThrow('bad_base64');
    expect(() => fromBase64('abc')).toThrow('bad_base64');
  });
});

describe('repetición', () => {
  test('una partida de bot grabada y repetida acaba con el mismo hash', () => {
    const sim = createSim(opts());
    play(sim, 6000);
    expect(sim.probes[0]!.level).toBeGreaterThan(2);
    const again = replay({ ...opts(), record: false }, decodeLog(encodeLog(sim.log!)), sim.tick);
    expect(again.tick).toBe(sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });

  test('también con 2 sondas', () => {
    const sim = createSim(opts(2, '77'));
    play(sim, 4000);
    const again = replay({ ...opts(2, '77'), record: false }, sim.log!, sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });

  test('una partida de 3 minutos ocupa menos de 20 KB', () => {
    const sim = createSim(opts());
    play(sim, 3 * 60 * 60);
    expect(encodeLog(sim.log!).length).toBeLessThan(20_000);
  });
});

describe('repetición con evoluciones', () => {
  /** Pulse already at its max level, so the bot (taking the Capacitor, then the evolution) evolves early. */
  function evolving(small: boolean): SimOptions {
    const content = structuredClone(DEFAULT_CONTENT);
    const pulse = content.weapons.find((w) => w.id === 'pulse')!;
    pulse.levels = [pulse.levels[0]!];
    if (small) content.limits = { ...content.limits, enemies: 25, shots: 12, areas: 4 };
    return { ...opts(1, '31337'), content };
  }
  const pick = (offer: readonly { kind: string; id: string }[]) => {
    const evo = offer.findIndex((o) => o.kind === 'evolve');
    if (evo >= 0) return evo;
    const cap = offer.findIndex((o) => o.id === 'capacitor');
    return cap >= 0 ? cap : botPick(offer as never);
  };
  function playEvolving(sim: Sim, ticks: number): void {
    while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
      if (sim.status === 'choosing') step(sim, sim.probes.map((p) => ({ mx: 0, my: 0, aim: -1, pick: p.offer ? pick(p.offer) : -1 })));
      else step(sim, sim.probes.map((p) => botInput(sim, p.index)));
    }
  }

  test.each([false, true])('una partida que evoluciona a mitad se repite con el mismo hash (piscinas pequeñas: %s)', (small) => {
    const sim = createSim(evolving(small));
    playEvolving(sim, 7000);
    expect(sim.probes[0]!.weapons.map((w) => w.id)).toContain('pulse-storm');
    const again = replay({ ...evolving(small), record: false }, decodeLog(encodeLog(sim.log!)), sim.tick);
    expect(stateHash(again)).toBe(stateHash(sim));
  });
});

// The panel's replayer (M6d-3) steps a recorded run one step at a time, so the arena can draw it as it goes.
describe('el reproductor paso a paso', () => {
  const recorded = () => {
    const sim = createSim(opts());
    play(sim, 3000);
    return { sim, log: decodeLog(encodeLog(sim.log!)) };
  };

  test('paso a paso llega al mismo estado que replay', () => {
    const { sim, log } = recorded();
    const r = createReplayer({ ...opts(), record: false }, log, sim.tick);
    while (r.next());
    expect(r.sim.tick).toBe(sim.tick);
    expect(stateHash(r.sim)).toBe(stateHash(sim));
    expect(stateHash(r.sim)).toBe(stateHash(replay({ ...opts(), record: false }, log, sim.tick)));
  });

  test('se para en until aunque el mundo siga', () => {
    const { log } = recorded();
    const r = createReplayer({ ...opts(), record: false }, log, 1200);
    while (r.next());
    expect(r.sim.tick).toBe(1200);
    expect(r.next()).toBe(false);
    expect(r.sim.tick).toBe(1200);
  });

  test('cada next es un solo step: un tick del mundo, o una elección sin tick', () => {
    const { sim, log } = recorded();
    expect(sim.probes[0]!.level).toBeGreaterThan(1);
    const r = createReplayer({ ...opts(), record: false }, log, sim.tick);
    let picks = 0;
    for (;;) {
      const before = r.sim.tick;
      const choosing = r.sim.status === 'choosing';
      if (!r.next()) break;
      if (choosing) {
        picks++;
        expect(r.sim.tick).toBe(before);
      } else expect(r.sim.tick).toBe(before + 1);
    }
    expect(picks).toBe(sim.probes[0]!.level - 1);
  });
});

// Watching a solo run live (plan «escáner pro», part G): the player's client sends its log in pieces as it plays, the
// server checks each piece and passes it on, and the viewer replays it as it comes, waiting where the log has not
// arrived yet (above all at a level-up choice).
describe('el directo en solitario', () => {
  const recorded = () => {
    const sim = createSim(opts());
    play(sim, 3000);
    return sim;
  };
  /** The log cut into pieces of `ticks` world ticks each: the events of each piece and the tick it reaches. */
  const pieces = (events: readonly number[], end: number, ticks: number) => {
    const out: { from: number; to: number; tick: number }[] = [];
    let from = 0;
    let prev = 0;
    for (let to = ticks; ; to += ticks) {
      const reach = Math.min(to, end);
      let i = from;
      while (i + 5 < events.length && events[i]! <= reach) i += 6;
      out.push({ from, to: i, tick: reach });
      from = i;
      prev = reach;
      if (reach >= end) break;
    }
    expect(prev).toBe(end);
    return out;
  };

  test('el registro en trozos da los mismos bytes que encodeLog', () => {
    const sim = recorded();
    const ev = sim.log!.events;
    let tick = 0;
    const bytes: number[] = [];
    for (const piece of pieces(ev, sim.tick, 97)) {
      const chunk = encodeEvents(ev.slice(piece.from, piece.to), tick);
      bytes.push(...chunk.bytes);
      tick = chunk.tick;
    }
    expect(Uint8Array.from([1, 1, ...bytes])).toEqual(encodeLog(sim.log!));
    expect(decodeEvents(Uint8Array.from(bytes), 0, 1).events).toEqual(ev);
  });

  test('un trozo sigue la cuenta de ticks del anterior', () => {
    const sim = recorded();
    const ev = sim.log!.events;
    const half = Math.floor(ev.length / 12) * 6;
    const a = encodeEvents(ev.slice(0, half), 0);
    const b = encodeEvents(ev.slice(half), a.tick);
    expect(decodeEvents(a.bytes, 0, 1)).toEqual({ events: ev.slice(0, half), tick: a.tick });
    expect(decodeEvents(b.bytes, a.tick, 1).events).toEqual(ev.slice(half));
    expect(encodeEvents([], 40)).toEqual({ bytes: new Uint8Array(0), tick: 40 });
  });

  test('un trozo con eventos de grupo, de otra sonda, o cortado, no vale', () => {
    // A pick of the co-op kind (2), a probe the run does not have, a move cut short.
    expect(() => decodeEvents(Uint8Array.from([0, 0, 2, 1, 0]), 0, 1)).toThrow('bad_log');
    expect(() => decodeEvents(Uint8Array.from([0, 1, 0, 127, 127, 0]), 0, 1)).toThrow('bad_log');
    expect(() => decodeEvents(Uint8Array.from([0, 0, 0, 127]), 0, 1)).toThrow('bad_log');
    expect(() => encodeEvents([5, 0, 2, 1, 0, 0], 0)).toThrow('bad_log');
    expect(() => encodeEvents([5, 0, 0, 0, 0, 0], 9)).toThrow('bad_log');
  });

  test('el reproductor en directo llega al mismo estado, trozo a trozo, y espera donde falta el registro', () => {
    const sim = recorded();
    const ev = sim.log!.events;
    const live = createLiveReplayer({ ...opts(), record: false });
    let waits = 0;
    for (const piece of pieces(ev, sim.tick, 61)) {
      live.push(ev.slice(piece.from, piece.to));
      let r: ReturnType<typeof live.next>;
      while ((r = live.next(piece.tick)) === 'stepped');
      expect(r).toBe('wait');
      waits++;
      // It never runs past what it was told.
      expect(live.sim.tick).toBeLessThanOrEqual(piece.tick);
    }
    expect(waits).toBeGreaterThan(10);
    expect(live.sim.tick).toBe(sim.tick);
    expect(stateHash(live.sim)).toBe(stateHash(sim));
  });

  test('en una elección espera a que llegue la mejora elegida, sin pararse para siempre', () => {
    const sim = recorded();
    const ev = sim.log!.events;
    let pick = 0;
    while (ev[pick + 2] !== 1) pick += 6;
    const at = ev[pick]!;
    const live = createLiveReplayer({ ...opts(), record: false });
    live.push(ev.slice(0, pick));
    while (live.next(at) === 'stepped');
    expect(live.sim.status).toBe('choosing');
    expect(live.sim.tick).toBe(at);
    expect(live.next(at)).toBe('wait');
    live.push(ev.slice(pick));
    expect(live.next(at)).toBe('stepped');
    expect(live.sim.status).toBe('running');
    while (live.next(sim.tick) === 'stepped');
    expect(stateHash(live.sim)).toBe(stateHash(sim));
  });

  test('un registro que no cuadra en la elección termina el directo', () => {
    const sim = recorded();
    const ev = sim.log!.events;
    let pick = 0;
    while (ev[pick + 2] !== 1) pick += 6;
    const live = createLiveReplayer({ ...opts(), record: false });
    live.push(ev.slice(0, pick));
    while (live.next(ev[pick]!) === 'stepped');
    live.push([ev[pick]! + 3, 0, 1, 0, 0, 0]);
    expect(live.next(ev[pick]!)).toBe('over');
  });
});
