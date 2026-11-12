import { SOLO_CHUNK_MAX, type SoloPlayState, type SoloStreamMessage, type SoloStreamServerMessage } from '@galaxy/shared';
import { decodeEvents, encodeEvents, fromBase64, type InputLog } from '@galaxy/sim';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createRunStream, type StreamSocket } from '../src/arena/run-stream';

// A solo run streaming its log live (plan «escáner pro», part G): nothing before the server's hello, then what the
// server lacks — rarely while nobody watches, often while someone does —, in pieces that fit a message; it resumes where
// the server says, retries when the socket drops, and never gets in the run's way.

class Sock implements StreamSocket {
  static all: Sock[] = [];
  readyState = 0;
  sent: SoloStreamMessage[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    Sock.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as SoloStreamMessage);
  }
  close(code?: number) {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  push(m: SoloStreamServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  pieces() {
    return this.sent.filter((m): m is Extract<SoloStreamMessage, { t: 'f' }> => m.t === 'f');
  }
}

let log: InputLog;
let tick: number;
let state: SoloPlayState;
const move = (t: number, mx = 1) => log.events.push(t, 0, 0, mx, 0, -1);
const start = () => createRunStream({ runId: 'r1', log: () => log, tick: () => tick, state: () => state, open: (url) => new Sock(url) });

beforeEach(() => {
  vi.useFakeTimers();
  Sock.all = [];
  log = { probes: 1, events: [] };
  tick = 0;
  state = 'run';
});
afterEach(() => vi.useRealTimers());

describe('el directo de la partida', () => {
  test('espera al hola, manda lo que falta, poco si nadie mira y a menudo si alguien mira', () => {
    const stream = start();
    const s = Sock.all[0]!;
    expect(s.url).toMatch(/\/galaxy\/api\/runs\/stream\/ws\?run=r1$/);
    move(1);
    move(40, -5);
    tick = 60;
    s.open();
    vi.advanceTimersByTime(3000);
    expect(s.sent).toEqual([]);

    s.push({ t: 'hello', have: 0, tick: 0, watched: false });
    expect(s.pieces()).toHaveLength(1);
    const first = s.pieces()[0]!;
    expect(first).toMatchObject({ at: 0, to: 60, s: 'run' });
    expect(decodeEvents(fromBase64(first.b), 0, 1).events).toEqual(log.events);

    // Nothing new: nothing sent. While nobody watches, every 2 s at most.
    vi.advanceTimersByTime(2000);
    expect(s.pieces()).toHaveLength(1);
    move(70);
    tick = 80;
    vi.advanceTimersByTime(1000);
    expect(s.pieces()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(s.pieces()).toHaveLength(2);
    expect(s.pieces()[1]).toMatchObject({ at: 2, to: 80 });
    expect(decodeEvents(fromBase64(s.pieces()[1]!.b), 40, 1).events).toEqual([70, 0, 0, 1, 0, -1]);

    // Someone watches: right away, then every 150 ms; the state alone is news too.
    s.push({ t: 'watch', on: true });
    tick = 90;
    vi.advanceTimersByTime(150);
    expect(s.pieces()).toHaveLength(3);
    state = 'pause';
    vi.advanceTimersByTime(150);
    expect(s.pieces().at(-1)).toMatchObject({ at: 3, b: '', to: 90, s: 'pause' });
    stream.close();
  });

  test('si el servidor tiene otra cuenta, sigue desde la suya', () => {
    start();
    const s = Sock.all[0]!;
    for (let t = 1; t <= 6; t++) move(t * 10, t);
    tick = 70;
    s.open();
    s.push({ t: 'hello', have: 4, tick: 40, watched: true });
    const p = s.pieces()[0]!;
    expect(p.at).toBe(4);
    expect(p.b).toBe(btoa(String.fromCharCode(...encodeEvents(log.events.slice(24), 40).bytes)));
  });

  test('un registro largo sale en trozos que caben, seguidos, dos cada vez y deprisa aunque nadie mire', () => {
    start();
    const s = Sock.all[0]!;
    for (let t = 1; t <= 900; t++) move(t * 400, (t % 200) - 100);
    tick = 900 * 400;
    s.open();
    s.push({ t: 'hello', have: 0, tick: 0, watched: false });
    // Two pieces at a time (under the server's rate), the rest every 150 ms until it is level.
    expect(s.pieces()).toHaveLength(2);
    vi.advanceTimersByTime(150);
    expect(s.pieces()).toHaveLength(4);
    vi.advanceTimersByTime(2000);
    const pieces = s.pieces();
    expect(pieces).toHaveLength(4);
    expect(pieces.length).toBeGreaterThan(2);
    let at = 0;
    let prev = 0;
    const events: number[] = [];
    for (const p of pieces) {
      expect(p.b.length).toBeLessThanOrEqual(SOLO_CHUNK_MAX);
      expect(p.at).toBe(at);
      const read = decodeEvents(fromBase64(p.b), prev, 1);
      expect(p.to).toBeGreaterThanOrEqual(read.tick);
      events.push(...read.events);
      at += read.events.length / 6;
      prev = read.tick;
    }
    expect(events).toEqual(log.events);
    expect(pieces.at(-1)!.to).toBe(tick);
  });

  test('si se cae reintenta y sigue; al terminar manda el final y no reintenta', () => {
    const stream = start();
    const s = Sock.all[0]!;
    move(5);
    tick = 10;
    s.open();
    s.push({ t: 'hello', have: 0, tick: 0, watched: false });
    s.drop();
    vi.advanceTimersByTime(1000);
    expect(Sock.all).toHaveLength(2);
    const s2 = Sock.all[1]!;
    s2.open();
    move(20);
    tick = 25;
    s2.push({ t: 'hello', have: 1, tick: 5, watched: false });
    expect(s2.pieces()[0]).toMatchObject({ at: 1, to: 25 });

    move(30);
    tick = 31;
    stream.end();
    expect(s2.sent.at(-2)).toMatchObject({ t: 'f', at: 2, to: 31 });
    expect(s2.sent.at(-1)).toEqual({ t: 'end' });
    expect(s2.closedWith).toBe(1000);
    s2.drop();
    vi.advanceTimersByTime(20_000);
    expect(Sock.all).toHaveLength(2);
  });

  test('un socket que no se puede abrir no rompe nada', () => {
    const stream = createRunStream({
      runId: 'r1',
      log: () => log,
      tick: () => tick,
      state: () => state,
      open: () => {
        throw new Error('no');
      },
    });
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
    stream.end();
    stream.close();
  });
});

test('un cierre definitivo (ya no es su partida, otra pestaña más nueva, registro malo) no reintenta', () => {
  for (const code of [4404, 4409, 4400, 4413]) {
    Sock.all = [];
    const stream = start();
    Sock.all[0]!.open();
    Sock.all[0]!.drop(code);
    vi.advanceTimersByTime(60_000);
    expect(Sock.all).toHaveLength(1);
    stream.close();
  }
  // A restart of the server (1012) is retried.
  Sock.all = [];
  start();
  Sock.all[0]!.drop(1012);
  vi.advanceTimersByTime(1000);
  expect(Sock.all).toHaveLength(2);
});
