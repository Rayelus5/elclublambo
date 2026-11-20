import type { AdminRunReplay, SoloStreamServerMessage, SoloWatchMessage } from '@galaxy/shared';
import { botInput, botPick, createSim, DEFAULT_CONTENT, decodeLog, encodeEvents, encodeLog, fromBase64, type Sim, step, toBase64 } from '@galaxy/sim';
import { describe, expect, test } from 'vitest';
import { type FeedSocket, SoloFeeds } from '../../src/runs/solo-feeds';

// Watching a solo run live on the server (plan «escáner pro», part G): the player's pieces of log are checked and
// kept, a viewer gets the whole log so far and then each piece, and the feed ends with the run, or a while after its
// player is gone.

class FakeSocket implements FeedSocket {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  last<T>(): T {
    return this.sent[this.sent.length - 1] as T;
  }
}

const start = { seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: [], bonuses: [], variant: null, anomaly: null, content: DEFAULT_CONTENT } as AdminRunReplay['start'];
/** Runs start an hour before the feeds' clock (T0), so the ticks they claim fit in the time they have run. */
const T0 = Date.parse('2026-11-12T11:00:00.000Z');
const STARTED = '2026-11-12T10:00:00.000Z';
const run = (id = 'r1', accountId = 'a1', startedAt = STARTED) => ({ id, accountId, player: 'vega', sector: 'outer-nebula', probe: 'lumen', startedAt });
const clockAt = (t = T0) => {
  const c = { t, now: () => c.t };
  return c;
};

function played(ticks: number): Sim {
  const sim = createSim({ seed: '20261112', content: DEFAULT_CONTENT, sector: 'outer-nebula', probes: [{ probe: 'lumen', relics: [] }], record: true });
  while (sim.tick < ticks && (sim.status === 'running' || sim.status === 'choosing')) {
    if (sim.status === 'choosing') step(sim, [{ mx: 0, my: 0, aim: -1, pick: botPick(sim.probes[0]!.offer!) }]);
    else step(sim, [botInput(sim, 0)]);
  }
  return sim;
}

/** The player's client: sends what its sim logged since the server's count, as one piece. */
function piece(sim: Sim, have: number, tick: number, s: 'run' | 'pick' | 'pause' = 'run') {
  const chunk = encodeEvents(sim.log!.events.slice(have * 6), tick);
  return { msg: { t: 'f' as const, at: have, b: toBase64(chunk.bytes), to: sim.tick, s }, events: sim.log!.events.length / 6, tick: chunk.tick };
}

describe('el directo de una partida en solitario', () => {
  test('el jugador recibe hola; sus trozos se guardan y pasan a quien mira, que empieza con todo el registro', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const player = new FakeSocket();
    expect(feeds.connect(run(), player)).toBe('ok');
    expect(player.last<SoloStreamServerMessage>()).toEqual({ t: 'hello', have: 0, tick: 0, watched: false });
    const sim = played(600);
    const p1 = piece(sim, 0, 0);
    feeds.message('r1', player, p1.msg);

    const viewer = new FakeSocket();
    expect(feeds.watch('r1', viewer, { start, contentFallback: false })).toBe(true);
    const hello = viewer.last<Extract<SoloWatchMessage, { t: 'hello' }>>();
    expect(hello).toMatchObject({ t: 'hello', run: { id: 'r1', player: 'vega' }, to: 600, s: 'run', contentFallback: false });
    expect(decodeLog(fromBase64(hello.log))).toEqual(decodeLog(encodeLog(sim.log!)));
    expect(player.last()).toEqual({ t: 'watch', on: true });

    const more = played(900);
    const p2 = piece(more, p1.events, p1.tick, 'pick');
    feeds.message('r1', player, p2.msg);
    expect(viewer.last()).toEqual({ t: 'f', b: p2.msg.b, to: 900, s: 'pick' });
    expect(feeds.list()).toEqual([{ runId: 'r1', player: 'vega', sector: 'outer-nebula', probe: 'lumen', startedAt: STARTED, tick: 900, state: 'pick', watchers: 1 }]);

    feeds.unwatch('r1', viewer);
    expect(player.last()).toEqual({ t: 'watch', on: false });
  });

  test('un trozo que no sigue recibe otra vez el hola; uno ilegible o que retrocede cierra el socket', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    const sim = played(300);
    const p1 = piece(sim, 0, 0);
    feeds.message('r1', player, p1.msg);
    feeds.message('r1', player, { ...p1.msg, at: 0 });
    expect(player.last()).toEqual({ t: 'hello', have: p1.events, tick: p1.tick, watched: false });
    expect(player.closed).toBeNull();
    feeds.message('r1', player, { t: 'f', at: p1.events, b: toBase64(Uint8Array.from([0, 0, 2, 1, 0])), to: 300, s: 'run' });
    expect(player.closed).toMatchObject({ code: 4400 });

    const again = new FakeSocket();
    feeds.connect(run(), again);
    // An older `to` is fine (the furthest counts); events past the `to` it gives are not.
    feeds.message('r1', again, { t: 'f', at: p1.events, b: '', to: 10, s: 'run' });
    expect(again.closed).toBeNull();
    expect(feeds.list()[0]!.tick).toBe(300);
    feeds.message('r1', again, { t: 'f', at: p1.events, b: toBase64(encodeEvents([p1.tick + 200, 0, 0, 0, 0, -1], p1.tick).bytes), to: p1.tick + 100, s: 'run' });
    expect(again.closed).toMatchObject({ code: 4400 });
  });

  test('si el jugador se cae, quien mira lo sabe; al volver sigue donde lo dejó', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    const sim = played(300);
    const p1 = piece(sim, 0, 0);
    feeds.message('r1', player, p1.msg);
    const viewer = new FakeSocket();
    feeds.watch('r1', viewer, { start, contentFallback: false });
    feeds.disconnect('r1', player);
    expect(viewer.last()).toEqual({ t: 'st', s: 'lost' });
    const back = new FakeSocket();
    feeds.connect(run(), back);
    expect(back.last()).toEqual({ t: 'hello', have: p1.events, tick: p1.tick, watched: true });
    // A second socket of the same run takes over; the old one closes.
    const other = new FakeSocket();
    feeds.connect(run(), other);
    expect(back.closed).toMatchObject({ code: 4409 });
  });

  test('al guardarse la partida se avisa y se cierra todo; sin jugador, al acabar la gracia, también', () => {
    const clock = clockAt();
    const feeds = new SoloFeeds({ now: clock.now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    const viewer = new FakeSocket();
    feeds.watch('r1', viewer, { start, contentFallback: false });
    feeds.message('r1', player, { t: 'end' });
    expect(viewer.last()).toEqual({ t: 'st', s: 'done' });
    feeds.end('r1');
    expect(viewer.last()).toEqual({ t: 'end' });
    expect(viewer.closed).toMatchObject({ code: 1000 });
    expect(player.closed).toMatchObject({ code: 1000 });
    expect(feeds.list()).toEqual([]);
    expect(feeds.watch('r1', new FakeSocket(), { start, contentFallback: false })).toBe(false);

    const p2 = new FakeSocket();
    feeds.connect(run('r2'), p2);
    feeds.disconnect('r2', p2);
    clock.t = T0 + 4 * 60_000;
    feeds.sweep();
    expect(feeds.list()).toHaveLength(1);
    clock.t = T0 + 6 * 60_000;
    feeds.sweep();
    expect(feeds.list()).toEqual([]);
  });

  test('una partida nueva de la misma cuenta cierra la anterior', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const old = new FakeSocket();
    feeds.connect(run('r1'), old);
    const viewer = new FakeSocket();
    feeds.watch('r1', viewer, { start, contentFallback: false });
    feeds.connect(run('r2', 'a1', '2026-11-12T10:30:00.000Z'), new FakeSocket());
    expect(viewer.last()).toEqual({ t: 'end' });
    expect(feeds.list().map((r) => r.runId)).toEqual(['r2']);
    // The older run's tab coming back does not take it back: it is told so, for good.
    expect(feeds.connect(run('r1'), new FakeSocket())).toBe('older');
    expect(feeds.list().map((r) => r.runId)).toEqual(['r2']);
  });

  test('quien mira y se queda atrás se cierra, y un registro demasiado grande corta el directo', () => {
    const small = piece(played(60), 0, 0);
    const feeds = new SoloFeeds({ now: clockAt().now, maxBytes: fromBase64(small.msg.b).length + 8 });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    const slow = new FakeSocket();
    feeds.watch('r1', slow, { start, contentFallback: false });
    slow.bufferedAmount = 5_000_000;
    feeds.message('r1', player, small.msg);
    expect(slow.closed).toMatchObject({ code: 4408 });
    expect(player.closed).toBeNull();
    feeds.message('r1', player, piece(played(2000), small.events, small.tick).msg);
    expect(player.closed).toMatchObject({ code: 4413 });
    expect(feeds.list()).toEqual([]);
  });

  test('no caben más directos que el máximo', () => {
    const feeds = new SoloFeeds({ now: clockAt().now, maxFeeds: 2 });
    expect(feeds.connect(run('r1', 'a1'), new FakeSocket())).toBe('ok');
    expect(feeds.connect(run('r2', 'a2'), new FakeSocket())).toBe('ok');
    expect(feeds.connect(run('r3', 'a3'), new FakeSocket())).toBe('busy');
  });
});

describe('el directo aguanta lo que no debería pasar', () => {
  test('un jugador conectado pero callado (una pausa larga) no se cierra; sin socket, sí', () => {
    const clock = clockAt();
    const feeds = new SoloFeeds({ now: clock.now });
    feeds.connect(run(), new FakeSocket());
    clock.t = T0 + 30 * 60_000;
    feeds.sweep();
    expect(feeds.list()).toHaveLength(1);
  });

  test('un tick por delante del tiempo que lleva la partida no vale', () => {
    const clock = clockAt(Date.parse(STARTED) + 10_000);
    const feeds = new SoloFeeds({ now: clock.now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    // Ten seconds in: 600 ticks, and some slack; not an hour.
    feeds.message('r1', player, { t: 'f', at: 0, b: '', to: 60 * 60 * 60, s: 'run' });
    expect(player.closed).toMatchObject({ code: 4400 });
  });

  test('no caben más bytes de los que dan de sí los ticks, ni en total más del presupuesto', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    // A thousand moves all on tick 1: no run logs that.
    const stuffed: number[] = [];
    for (let i = 0; i < 1000; i++) stuffed.push(1, 0, 0, 5, 5, 10);
    feeds.message('r1', player, { t: 'f', at: 0, b: toBase64(encodeEvents(stuffed, 0).bytes), to: 1, s: 'run' });
    expect(player.closed).toMatchObject({ code: 4413 });

    const small = piece(played(600), 0, 0);
    const tight = new SoloFeeds({ now: clockAt().now, maxTotalBytes: fromBase64(small.msg.b).length + 10 });
    const a = new FakeSocket();
    const b = new FakeSocket();
    tight.connect(run('r1', 'a1'), a);
    tight.connect(run('r2', 'a2'), b);
    tight.message('r1', a, small.msg);
    expect(a.closed).toBeNull();
    tight.message('r2', b, small.msg);
    expect(b.closed).toMatchObject({ code: 4413 });
  });

  test('al apagarse el servidor no se dice que la partida terminó', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    const viewer = new FakeSocket();
    feeds.watch('r1', viewer, { start, contentFallback: false });
    feeds.close();
    expect(viewer.sent.some((m) => (m as { t: string }).t === 'end')).toBe(false);
    expect(viewer.closed).toMatchObject({ code: 1012 });
    expect(player.closed).toMatchObject({ code: 1012 });
  });

  test('el jugador oye que ya nadie mira aunque el último se fuera sin despedirse', () => {
    const feeds = new SoloFeeds({ now: clockAt().now });
    const player = new FakeSocket();
    feeds.connect(run(), player);
    const viewer = new FakeSocket();
    feeds.watch('r1', viewer, { start, contentFallback: false });
    viewer.readyState = 3;
    feeds.message('r1', player, piece(played(120), 0, 0).msg);
    expect(player.last()).toEqual({ t: 'watch', on: false });
  });
});
