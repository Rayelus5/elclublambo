import type { SoloPlayState, SoloStreamServerMessage } from '@galaxy/shared';
import { encodeEvents, type InputLog, toBase64 } from '@galaxy/sim';

// A solo run's live feed (plan «escáner pro», part G; the owner: «los admins deberían de poder ver partidas
// individuales en directo»). While the run is played its input log goes to the server in pieces: every 2 s while
// nobody watches, every 150 ms while staff do. The server says, on connecting and whenever a piece does not follow, how
// much of the log it has; the stream sends from there. It never gets in the run's way: a socket that will not open,
// drops or misbehaves is retried in the background, and nothing here throws into the game loop.

/** The bits of a WebSocket the stream uses (the browser's fits; the tests use a fake). */
export interface StreamSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
}

const OPEN = 1;
const WATCHED_MS = 150;
const IDLE_MS = 2000;
const RETRY_MS = [1000, 2000, 5000, 10_000];
/** Events per piece: at most 9 bytes each, so a piece stays under SOLO_CHUNK_MAX once in base64. */
const PER_PIECE = 250;

export interface RunStream {
  /** The run is over: what is left, then «end», and the socket closes for good. */
  end(): void;
  /** Stops without a word (the screen went away). */
  close(): void;
}

const defaultOpen = (url: string): StreamSocket => new WebSocket(url) as unknown as StreamSocket;

export function createRunStream(opts: {
  runId: string;
  log: () => InputLog | null;
  tick: () => number;
  state: () => SoloPlayState;
  open?: (url: string) => StreamSocket;
}): RunStream {
  const open = opts.open ?? defaultOpen;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/galaxy/api/runs/stream/ws?run=${encodeURIComponent(opts.runId)}`;
  let socket: StreamSocket | null = null;
  let ready = false;
  let watched = false;
  /** Events the server has (sent and not refused), and the tick of the last of them. */
  let cursor = 0;
  let prevTick = 0;
  let sentTo = -1;
  let sentState: SoloPlayState | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let done = false;

  const send = (m: unknown) => {
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(m));
  };

  function flush(): void {
    if (!ready || !socket || socket.readyState !== OPEN) return;
    const events = opts.log()?.events ?? [];
    const total = Math.floor(events.length / 6);
    const to = opts.tick();
    const s = opts.state();
    if (cursor >= total && to === sentTo && s === sentState) return;
    do {
      const upto = Math.min(total, cursor + PER_PIECE);
      const piece = encodeEvents(events.slice(cursor * 6, upto * 6), prevTick);
      // A piece with more behind it only claims the tick its own events reach.
      const reach = upto < total ? piece.tick : Math.max(to, piece.tick);
      send({ t: 'f', at: cursor, b: toBase64(piece.bytes), to: reach, s });
      cursor = upto;
      prevTick = piece.tick;
      sentTo = reach;
    } while (cursor < total);
    sentState = s;
  }

  function pace(): void {
    if (timer) clearInterval(timer);
    timer = done ? null : setInterval(() => safely(flush), watched ? WATCHED_MS : IDLE_MS);
  }

  function safely(fn: () => void): void {
    try {
      fn();
    } catch {
      // Never into the run.
    }
  }

  function onMessage(raw: string): void {
    const m = JSON.parse(raw) as SoloStreamServerMessage;
    if (m.t === 'hello') {
      cursor = m.have;
      prevTick = m.tick;
      watched = m.watched;
      sentTo = -1;
      sentState = null;
      ready = true;
      attempts = 0;
      pace();
      flush();
    } else if (m.t === 'watch') {
      watched = m.on;
      pace();
      if (m.on) flush();
    }
  }

  function connect(): void {
    retry = null;
    if (done) return;
    ready = false;
    try {
      const s = open(url);
      socket = s;
      s.onmessage = (e) => safely(() => onMessage(e.data));
      s.onerror = () => {};
      s.onclose = () => {
        if (socket !== s) return;
        socket = null;
        ready = false;
        reconnect();
      };
    } catch {
      socket = null;
      reconnect();
    }
  }

  function reconnect(): void {
    if (done || retry) return;
    const wait = RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)]!;
    attempts++;
    retry = setTimeout(connect, wait);
  }

  function stop(): void {
    done = true;
    if (timer) clearInterval(timer);
    if (retry) clearTimeout(retry);
    timer = null;
    retry = null;
    const s = socket;
    socket = null;
    ready = false;
    if (s) safely(() => s.close(1000));
  }

  connect();
  return {
    end() {
      if (done) return;
      safely(flush);
      safely(() => send({ t: 'end' }));
      stop();
    },
    close: stop,
  };
}
