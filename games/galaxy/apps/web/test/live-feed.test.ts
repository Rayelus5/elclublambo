import type { AdminRunReplay, SoloWatchMessage } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, encodeEvents, encodeLog, type Sim, stateHash, step, toBase64 } from '@galaxy/sim';
import { describe, expect, test } from 'vitest';
import { createLiveFeed } from '../src/admin/replay/live-feed';

// The staff's view of a solo run live (plan «escáner pro», part G): the hello's log is replayed to the tick the run had
// reached, every piece after it carries it on, and it waits — at the live edge, or at a level-up whose pick has not
// arrived — rather than stopping.

const start: AdminRunReplay['start'] = { seed: '20261112', sector: 'outer-nebula', probe: 'lumen', relics: [], bonuses: [], variant: null, anomaly: null, content: DEFAULT_CONTENT };

function played(ticks: number): Sim {
  const sim = createSim({ seed: start.seed, content: DEFAULT_CONTENT, sector: start.sector, probes: [{ probe: 'lumen', relics: [], bonuses: [], variant: null }], anomaly: null, record: true });
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(sim.probes[0]!.offer!) }]);
    else step(sim, [botInput(sim, 0)]);
  }
  return sim;
}

const hello = (log: Uint8Array, to: number, s: 'run' | 'pause' = 'run'): SoloWatchMessage => ({
  t: 'hello',
  run: { id: 'r1', player: 'vega', startedAt: '2026-11-12T10:00:00.000Z' },
  start,
  contentFallback: false,
  log: toBase64(log),
  to,
  s,
});

describe('el directo visto desde el panel', () => {
  test('se pone al día con el hola, sigue con cada trozo y llega al mismo estado', () => {
    const full = played(1500);
    const ev = full.log!.events;
    let cut = 0;
    while (cut + 5 < ev.length && ev[cut]! <= 700) cut += 6;
    const feed = createLiveFeed();
    expect(feed.state).toBe('connecting');
    feed.apply(hello(encodeLog({ probes: 1, events: ev.slice(0, cut) }), 700));
    expect(feed.state).toBe('run');
    expect(feed.behind).toBe(700);
    let events = 0;
    while (feed.advance(500, (e) => (events += e.length)) > 0);
    expect(feed.sim!.tick).toBe(700);
    expect(feed.behind).toBe(0);
    expect(events).toBeGreaterThan(0);

    const rest = encodeEvents(ev.slice(cut), ev[cut - 6]!);
    feed.apply({ t: 'f', b: toBase64(rest.bytes), to: full.tick, s: 'pick' });
    expect(feed.state).toBe('pick');
    while (feed.advance(500) > 0);
    expect(feed.sim!.tick).toBe(full.tick);
    expect(stateHash(feed.sim!)).toBe(stateHash(full));
  });

  test('en una elección sin su mejora espera; los cambios de estado y el final se leen', () => {
    const full = played(1500);
    const ev = full.log!.events;
    let pick = 0;
    while (ev[pick + 2] !== 1) pick += 6;
    const feed = createLiveFeed();
    feed.apply(hello(encodeLog({ probes: 1, events: ev.slice(0, pick) }), ev[pick]!));
    while (feed.advance(500) > 0);
    expect(feed.waiting).toBe(true);
    expect(feed.sim!.status).toBe('choosing');
    feed.apply({ t: 'st', s: 'lost' });
    expect(feed.state).toBe('lost');
    feed.apply({ t: 'f', b: toBase64(encodeEvents(ev.slice(pick, pick + 6), ev[pick - 6]!).bytes), to: ev[pick]!, s: 'run' });
    expect(feed.state).toBe('run');
    expect(feed.advance(1)).toBe(1);
    expect(feed.waiting).toBe(false);
    feed.apply({ t: 'end' });
    expect(feed.state).toBe('ended');
  });

  test('un trozo que no se lee deja el directo roto, sin romper la página', () => {
    const feed = createLiveFeed();
    feed.apply(hello(encodeLog({ probes: 1, events: [] }), 0));
    expect(() => feed.apply({ t: 'f', b: toBase64(Uint8Array.from([0, 0, 2, 1, 0])), to: 5, s: 'run' })).not.toThrow();
    expect(feed.state).toBe('broken');
    expect(feed.advance(100)).toBe(0);
  });

  test('un hola que no se lee también lo deja roto; y una repetición que se acaba ya no va por detrás', () => {
    const bad = createLiveFeed();
    bad.apply({ ...(hello(encodeLog({ probes: 1, events: [] }), 0) as Extract<SoloWatchMessage, { t: 'hello' }>), log: 'AAAA' });
    expect(bad.state).toBe('broken');
    expect(bad.hello).toBeNull();

    const full = played(1500);
    const ev = full.log!.events;
    let pick = 0;
    while (ev[pick + 2] !== 1) pick += 6;
    const feed = createLiveFeed();
    feed.apply(hello(encodeLog({ probes: 1, events: [...ev.slice(0, pick), ev[pick]! + 3, 0, 1, 0, 0, 0] }), ev[pick]! + 600));
    while (feed.advance(500) > 0);
    expect(feed.over).toBe(true);
    expect(feed.behind).toBe(0);
  });
});
