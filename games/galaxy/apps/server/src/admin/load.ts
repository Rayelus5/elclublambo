import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { AdminLoadSample, AdminLoadView } from '@galaxy/shared';
import type { FastifyInstance } from 'fastify';
import { requireStaff } from '../auth/guards';

// The server's load for the admin (2026-11-17, the owner: «ver la carga del multijugador en el servidor desde el admin»):
// every `everyMs` a sample of the rooms, the group runs and their referee, the solo runs, the live sockets, the event
// loop's delay, the CPU and the memory, kept for the last `keep` samples (an hour) in memory. Moderación › Salas en vivo
// shows it; a deploy starts it again. A source that fails counts as 0 (the panel never breaks the server).

export interface LoadSources {
  rooms: () => { lobby: number; starting: number; running: number; max: number; players: number };
  coop: () => { runs: number; connected: number; coreShare: number; p99: number };
  solo: () => number;
  sockets: () => number;
}

/** Where the numbers of the process come from (injectable for the tests). */
export interface LoadReaders {
  now: () => number;
  /** CPU used by the process so far, user + system (µs). */
  cpu: () => number;
  memory: () => { rss: number; heapUsed: number };
  /** The event loop's delay since the last reset (ms). */
  loop: { p50: () => number; p99: () => number; max: () => number; reset: () => void };
  uptime: () => number;
}

/** The real process: perf_hooks' event-loop histogram (20 ms resolution), process.cpuUsage, memoryUsage, uptime. */
export function processReaders(): LoadReaders & { stop: () => void } {
  const h = monitorEventLoopDelay({ resolution: 20 });
  h.enable();
  const ms = (ns: number) => (Number.isFinite(ns) ? ns / 1e6 : 0);
  return {
    now: Date.now,
    cpu: () => {
      const u = process.cpuUsage();
      return u.user + u.system;
    },
    memory: () => process.memoryUsage(),
    loop: { p50: () => ms(h.percentile(50)), p99: () => ms(h.percentile(99)), max: () => ms(h.max), reset: () => h.reset() },
    uptime: () => process.uptime(),
    stop: () => h.disable(),
  };
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

export interface LoadMonitor {
  /** Takes a sample now and keeps it (the timer calls it). */
  sample(): AdminLoadSample;
  /** The kept samples and one read right now (not kept). */
  view(): AdminLoadView;
  start(): void;
  stop(): void;
}

export function createLoadMonitor(sources: LoadSources, opts: { everyMs?: number; keep?: number; readers: LoadReaders & { stop?: () => void } }): LoadMonitor {
  const everyMs = opts.everyMs ?? 15_000;
  const keep = opts.keep ?? 240;
  const r = opts.readers;
  const ring: AdminLoadSample[] = [];
  let lastCpu = r.cpu();
  let lastAt = r.now();
  let timer: ReturnType<typeof setInterval> | null = null;

  function read(advance: boolean): AdminLoadSample {
    const at = r.now();
    const cpu = r.cpu();
    // µs of CPU over ms of wall clock: the share of one core.
    const share = at > lastAt ? (cpu - lastCpu) / 1000 / (at - lastAt) : 0;
    if (advance) {
      lastCpu = cpu;
      lastAt = at;
    }
    const rooms = safe(sources.rooms, { lobby: 0, starting: 0, running: 0, max: 0, players: 0 });
    const coop = safe(sources.coop, { runs: 0, connected: 0, coreShare: 0, p99: 0 });
    const memory = safe(r.memory, { rss: 0, heapUsed: 0 });
    return {
      at: new Date(at).toISOString(),
      rooms: { lobby: rooms.lobby, starting: rooms.starting, running: rooms.running, max: rooms.max },
      players: rooms.players,
      coop: { runs: coop.runs, connected: coop.connected },
      solo: safe(sources.solo, 0),
      sockets: safe(sources.sockets, 0),
      referee: { core: round(coop.coreShare, 4), p99: round(coop.p99) },
      loop: { p50: round(safe(r.loop.p50, 0)), p99: round(safe(r.loop.p99, 0)), max: round(safe(r.loop.max, 0)) },
      cpu: round(Math.max(0, share), 4),
      memory: { rss: memory.rss, heap: memory.heapUsed },
      uptime: Math.round(safe(r.uptime, 0)),
    };
  }

  const monitor: LoadMonitor = {
    sample() {
      const s = read(true);
      safe(r.loop.reset, undefined);
      ring.push(s);
      if (ring.length > keep) ring.shift();
      return s;
    },
    view() {
      return { now: read(false), history: [...ring], sampleMs: everyMs };
    },
    start() {
      if (timer) return;
      timer = setInterval(() => monitor.sample(), everyMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      r.stop?.();
    },
  };
  return monitor;
}

/** GET /galaxy/api/admin/load: the server's load for staff (moderators too, like the live rooms). */
export function registerLoadRoutes(api: FastifyInstance, monitor: LoadMonitor): void {
  api.get('/galaxy/api/admin/load', async (req): Promise<AdminLoadView> => {
    requireStaff(req);
    return monitor.view();
  });
}
