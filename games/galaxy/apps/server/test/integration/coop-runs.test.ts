import { type CoopServerMessage, PROBE_TEST, type RoomView, type RoomsView } from '@galaxy/shared';
import { decodeLog, fromBase64, MOVE } from '@galaxy/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type WebSocket from 'ws';
import type { CoopService } from '../../src/coop/service';
import { get, ORIGIN, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Co-op runs (multiplayer plan, phase 6): the leader launches, every player's socket gets the run and the same sealed
// inputs, a player who goes is out for good, the run ends when nobody is left, each player is paid once (with the
// group's factors), the room waits again; a launch is never doubled and a run a restart left behind is paid.
let ctx: Awaited<ReturnType<typeof testApp>>;
let coop: CoopService;
beforeAll(async () => {
  ctx = await testApp();
  coop = (ctx.app as unknown as { galaxyCoop: CoopService }).galaxyCoop;
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('cop');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await put(ctx.app, '/galaxy/api/tutorial', { action: 'skip' }, { cookie });
  // The probe test gives the probe a run needs.
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, username };
}
type P = Awaited<ReturnType<typeof player>>;
const act = (p: P, path: string, body?: unknown) => post(ctx.app, `/galaxy/api/rooms${path}`, body, { cookie: p.cookie });
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** A room of `n` players, everyone ready, launched by the first. */
async function launched(n = 2): Promise<{ players: P[]; room: RoomView }> {
  const players = await Promise.all(Array.from({ length: n }, () => player()));
  const room = (await act(players[0]!, '', { kind: 'private', sector: 'outer-nebula' })).json() as RoomView;
  for (const p of players.slice(1)) {
    expect((await act(p, '/join', { code: room.code })).statusCode).toBe(200);
    await act(p, '/ready', { ready: true });
  }
  const res = await act(players[0]!, '/start');
  expect(res.statusCode, res.body).toBe(200);
  return { players, room: res.json() as RoomView };
}

async function play(p: P, runId: string) {
  const got: CoopServerMessage[] = [];
  const ws: WebSocket = await ctx.app.injectWS(`/galaxy/api/coop/play/ws?run=${runId}`, { headers: { origin: ORIGIN, cookie: `gs_sid=${p.cookie}` } });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  ws.on('message', (data) => got.push(JSON.parse(String(data)) as CoopServerMessage));
  return { ws, got, closed, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

/** Every sealed event a player has received (its hello's log, then the frames), and the tick closed so far. */
function received(got: CoopServerMessage[]): { events: number[]; to: number } {
  const events: number[] = [];
  let to = 0;
  for (const m of got) {
    if (m.t === 'hello') {
      events.push(...decodeLog(fromBase64(m.log)).events);
      to = m.to;
    } else if (m.t === 'f') {
      events.push(...m.ev);
      to = m.to;
    }
  }
  return { events, to };
}

const waitFor = async (ok: () => boolean, ms = 4000) => {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error('timed out');
    await settle(30);
  }
};

describe('despegar y jugar', () => {
  test('el líder despega: la sala juega su partida y cada uno recibe la suya con su sitio', async () => {
    const { players, room } = await launched(2);
    expect(room.state).toBe('running');
    expect(room.run?.id).toBeTruthy();
    const [a, b] = [await play(players[0]!, room.run!.id), await play(players[1]!, room.run!.id)];
    await waitFor(() => a.got.some((m) => m.t === 'hello') && b.got.some((m) => m.t === 'hello'));
    const ha = a.got.find((m) => m.t === 'hello')!;
    const hb = b.got.find((m) => m.t === 'hello')!;
    if (ha.t !== 'hello' || hb.t !== 'hello') throw new Error('hello');
    expect([ha.start.slot, hb.start.slot]).toEqual([0, 1]);
    expect(ha.start.players.map((p) => p.username)).toEqual(players.map((p) => p.username));
    expect(ha.start.seed).toBe(hb.start.seed);
    expect(ha.start.rules.pickSeconds).toBe(15);
    // A sends a move: both get it sealed on the same tick, and the ticks keep closing.
    a.send({ t: 'in', mx: 127, my: 0, aim: -1 });
    await waitFor(() => {
      const ra = received(a.got);
      const rb = received(b.got);
      return ra.events.some((_, i) => i % 6 === 0 && ra.events[i + 1] === 0 && ra.events[i + 2] === MOVE && ra.events[i + 3] === 127) && rb.to >= ra.to && rb.to > 0;
    });
    await settle(200);
    const ra = received(a.got);
    const rb = received(b.got);
    const upTo = Math.min(ra.to, rb.to);
    const until = (ev: number[]) => ev.filter((_, i) => ev[i - (i % 6)]! <= upTo);
    expect(until(ra.events)).toEqual(until(rb.events));
    // While it plays nobody joins, and it is not launched twice.
    expect((await act(players[1]!, '/start')).json()).toMatchObject({ error: 'room_not_leader' });
    expect((await act(players[0]!, '/start')).json()).toMatchObject({ error: 'room_started' });
    a.ws.terminate();
    b.ws.terminate();
    await coop.abandon(room.run!.id);
  });

  test('quien no juega en la partida no entra en su socket', async () => {
    const { room } = await launched(1);
    const other = await player();
    const c = await play(other, room.run!.id);
    expect(await c.closed).toBe(4403);
    await coop.abandon(room.run!.id);
  });

  test('si se van todos, la partida acaba; cada uno cobra una vez con el factor del grupo y la sala vuelve a esperar', async () => {
    const { players, room } = await launched(2);
    const runId = room.run!.id;
    const [a, b] = [await play(players[0]!, runId), await play(players[1]!, runId)];
    await waitFor(() => a.got.some((m) => m.t === 'hello') && b.got.some((m) => m.t === 'hello'));
    await settle(400);
    a.send({ t: 'leave' });
    b.send({ t: 'leave' });
    await waitFor(() => a.got.some((m) => m.t === 'end') && b.got.some((m) => m.t === 'end'), 8000);
    const end = a.got.find((m) => m.t === 'end')!;
    if (end.t !== 'end') throw new Error('end');
    expect(end.outcome).toBe('died');
    expect(end.result?.outcome).toBe('abandoned');
    const rows = await ctx.db
      .selectFrom('galaxy.runs')
      .select(['slot', 'party_size', 'points_factor', 'outcome', 'finished_at'])
      .where('coop_run_id', '=', runId)
      .orderBy('slot')
      .execute();
    expect(rows.map((r) => [r.slot, r.party_size, r.outcome])).toEqual([
      [0, 2, 'abandoned'],
      [1, 2, 'abandoned'],
    ]);
    expect(rows.every((r) => r.finished_at !== null && Math.abs(r.points_factor - 0.85) < 1e-6)).toBe(true);
    const kept = await ctx.db.selectFrom('galaxy.coop_runs').select(['state', 'outcome']).where('id', '=', runId).executeTakeFirstOrThrow();
    expect(kept).toEqual({ state: 'ended', outcome: 'died' });
    const inputs = await ctx.db.selectFrom('galaxy.coop_run_inputs').select('ticks').where('coop_run_id', '=', runId).executeTakeFirstOrThrow();
    expect(inputs.ticks).toBeGreaterThan(0);
    // Paying again changes nothing.
    const ids = (await ctx.db.selectFrom('galaxy.runs').select('id').where('coop_run_id', '=', runId).execute()).map((r) => r.id);
    const entries = async () =>
      (await ctx.db.selectFrom('galaxy.ledger').select(sql<number>`count(*)::int`.as('n')).where(sql<string>`ref->>'run'`, 'in', ids).executeTakeFirstOrThrow()).n;
    const before = await entries();
    await coop.settleAgain(runId);
    expect(await entries()).toBe(before);
    const mine = (await get(ctx.app, '/galaxy/api/rooms', { cookie: players[0]!.cookie })).json() as RoomsView;
    expect(mine.mine).toMatchObject({ state: 'lobby', run: null });
    expect(mine.mine?.members.every((m) => !m.ready)).toBe(true);
  });
});

describe('reinicios', () => {
  test('una partida que un reinicio dejó a medias se paga como extracción de lo que llevaba', async () => {
    const { players, room } = await launched(2);
    const runId = room.run!.id;
    const a = await play(players[0]!, runId);
    await waitFor(() => a.got.some((m) => m.t === 'hello'));
    await settle(300);
    // The server goes down without settling: the run stays «running» with its log saved.
    await coop.forget(runId);
    a.ws.terminate();
    const later = new Date(Date.now() + 120_000);
    const paid = await coop.recover(later);
    expect(paid).toContain(runId);
    const rows = await ctx.db.selectFrom('galaxy.runs').select(['outcome', 'finished_at']).where('coop_run_id', '=', runId).execute();
    expect(rows.map((r) => r.outcome)).toEqual(['extracted', 'extracted']);
    expect((await ctx.db.selectFrom('galaxy.coop_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow()).state).toBe('interrupted');
    // Recovering again pays nothing more.
    expect(await coop.recover(later)).not.toContain(runId);
  });
});
