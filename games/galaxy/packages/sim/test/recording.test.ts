import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  botInput,
  botPick,
  createSim,
  DEFAULT_CONTENT,
  decodeLog,
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
