import { expect, test } from 'vitest';
import { createLoadMonitor, type LoadReaders, type LoadSources } from '../../src/admin/load';

// The server's load for the admin (2026-11-17, the owner: «ver la carga del multijugador en el servidor desde el admin»):
// a sample every few seconds of the rooms, the group runs and their referee, the solo runs, the live sockets, the event
// loop, the CPU and the memory, kept for the last hour (in memory: a deploy starts it again), and the sample now.

function setup(over: Partial<LoadSources> = {}) {
  let now = 1_000_000;
  let cpuUs = 0;
  const sources: LoadSources = {
    rooms: () => ({ lobby: 3, starting: 0, running: 2, max: 10, players: 9 }),
    coop: () => ({ runs: 2, connected: 7, coreShare: 0.012, p99: 0.8 }),
    solo: () => 4,
    sockets: () => 31,
    ...over,
  };
  const readers: LoadReaders = {
    now: () => now,
    // Every read, 300 ms of CPU more.
    cpu: () => (cpuUs += 300_000),
    memory: () => ({ rss: 210_000_000, heapUsed: 95_000_000 }),
    loop: { p50: () => 11, p99: () => 24, max: () => 61, reset: () => {} },
    uptime: () => 3600,
  };
  const monitor = createLoadMonitor(sources, { everyMs: 15_000, keep: 4, readers });
  return { monitor, tick: (ms: number) => (now += ms) };
}

test('una muestra dice salas por estado y su máximo, jugadores, partidas, sockets, árbitro, bucle, CPU y memoria', () => {
  const { monitor, tick } = setup();
  monitor.sample();
  tick(15_000);
  const s = monitor.sample();
  expect(s.rooms).toEqual({ lobby: 3, starting: 0, running: 2, max: 10 });
  expect(s.players).toBe(9);
  expect(s.coop).toEqual({ runs: 2, connected: 7 });
  expect(s.solo).toBe(4);
  expect(s.sockets).toBe(31);
  expect(s.referee).toEqual({ core: 0.012, p99: 0.8 });
  expect(s.loop).toEqual({ p50: 11, p99: 24, max: 61 });
  // 300 ms of CPU in 15 s: 2 % of a core.
  expect(s.cpu).toBeCloseTo(0.02, 5);
  expect(s.memory).toEqual({ rss: 210_000_000, heap: 95_000_000 });
  expect(s.uptime).toBe(3600);
});

test('guarda la última hora (las últimas `keep` muestras), de la más vieja a la más nueva', () => {
  const { monitor, tick } = setup();
  for (let i = 0; i < 6; i++) {
    monitor.sample();
    tick(15_000);
  }
  const view = monitor.view();
  expect(view.history).toHaveLength(4);
  expect(view.sampleMs).toBe(15_000);
  const times = view.history.map((h) => Date.parse(h.at));
  expect(times).toEqual([...times].sort((a, b) => a - b));
  // «Now» is read on the spot, not from the last sample.
  expect(Date.parse(view.now.at)).toBeGreaterThan(times.at(-1)!);
});

test('si una fuente falla, la muestra sale igual con lo demás', () => {
  const { monitor } = setup({ solo: () => { throw new Error('x'); } });
  expect(monitor.sample().solo).toBe(0);
});
