import { expect, test } from 'vitest';
import { botInput, CoopFeed, createSim, DASH, DEFAULT_COOP_RULES, MOVE, type ProbeInput, replay, type Sim, stateHash, step } from '../src/index';
import { options, tinyContent } from './fixtures';

// The co-op input feed (multiplayer plan, phase 6): the server seals inputs as log events and hands them out in
// batches; the referee, every client and the replayer turn them into each tick's inputs the same way. A run fed in
// any batches ends exactly where the recorded run did.

function recorded(): { sim: Sim; opts: Parameters<typeof createSim>[0] } {
  const content = tinyContent((c) => {
    c.probes[0]!.weapon = 'pulse';
    c.probes[0]!.hp = 1_000_000;
    c.sectors[0]!.density = { ...c.sectors[0]!.density, base: 2, max: 2 };
    c.sectors[0]!.spawns = c.sectors[0]!.spawns.map((sp) => ({ ...sp, from: 0 }));
  });
  const opts = options(content, { coop: DEFAULT_COOP_RULES, record: true, probes: [0, 1, 2].map(() => ({ probe: content.probes[0]!.id, relics: [] })) });
  const sim = createSim(opts);
  let presence = 0;
  while (sim.tick < 2400 && sim.status === 'running') {
    const inputs = sim.probes.map((p): ProbeInput => {
      const input: ProbeInput = { ...botInput(sim, p.index), presence: p.index === 2 ? presence : 0 };
      return p.offer && sim.tick % 29 === 0 ? { ...input, pick: sim.tick % p.offer.length, offer: p.offerSeq & 255 } : input;
    });
    if (sim.tick === 700) presence = 1;
    if (sim.tick === 1300) presence = 0;
    step(sim, inputs);
  }
  return { sim, opts };
}

/** A tiny deterministic generator for the batch sizes. */
function sizes(seed: number): () => number {
  let s = seed;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return 1 + (s % 40);
  };
}

test('una partida alimentada a trozos al azar acaba igual que la grabada', () => {
  const { sim, opts } = recorded();
  const events = sim.log!.events;
  for (const seed of [1, 7, 99]) {
    const next = sizes(seed);
    const feed = new CoopFeed(sim.probes.length);
    const again = createSim({ ...opts, record: false });
    let sent = 0;
    while (again.tick < sim.tick) {
      const tick = again.tick + 1;
      // What the server has closed up to this tick, in batches of any size.
      while (sent < events.length && events[sent]! <= tick) {
        const n = Math.min(events.length - sent, next() * 6);
        feed.push(events.slice(sent, sent + n));
        sent += n;
      }
      step(again, feed.inputsFor(tick));
    }
    expect(stateHash(again)).toBe(stateHash(sim));
  }
});

test('el repetidor de grupo (que usa la misma alimentación) también acaba igual', () => {
  const { sim, opts } = recorded();
  expect(stateHash(replay({ ...opts, record: false }, sim.log!, sim.tick))).toBe(stateHash(sim));
});

test('una carta vale solo en su tick; el movimiento y la presencia siguen hasta que cambian', () => {
  const feed = new CoopFeed(2);
  feed.push([3, 0, 0, 50, -20, 100, 3, 1, 2, 1, 4, 0, 5, 1, 3, 1, 0, 0]);
  expect(feed.inputsFor(1)[0]).toMatchObject({ mx: 0, my: 0, pick: -1 });
  expect(feed.inputsFor(3)).toEqual([
    { mx: 50, my: -20, aim: 100, pick: -1, presence: 0 },
    { mx: 0, my: 0, aim: -1, pick: 1, offer: 4, presence: 0 },
  ]);
  expect(feed.inputsFor(4)[1]).toMatchObject({ pick: -1 });
  expect(feed.inputsFor(5)).toEqual([
    { mx: 50, my: -20, aim: 100, pick: -1, presence: 0 },
    { mx: 0, my: 0, aim: -1, pick: -1, presence: 1 },
  ]);
});

test('un dash cuenta solo en su tick, con su ángulo', () => {
  const feed = new CoopFeed(2);
  feed.push([5, 1, DASH, 1024, 0, 0, 5, 0, MOVE, 127, 0, -1]);
  expect(feed.inputsFor(4).every((i) => i.dash === undefined)).toBe(true);
  const at = feed.inputsFor(5);
  expect(at[1]!.dash).toBe(1024);
  expect(at[0]!.dash).toBeUndefined();
  expect(at[0]!.mx).toBe(127);
  expect(feed.inputsFor(6)[1]!.dash).toBeUndefined();
});
