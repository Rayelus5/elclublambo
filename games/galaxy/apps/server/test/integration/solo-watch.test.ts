import { randomUUID } from 'node:crypto';
import { PROBE_TEST, type RunStart, type SoloLiveList, type SoloStreamServerMessage, type SoloWatchMessage } from '@galaxy/shared';
import { decodeLog, encodeEvents, encodeLog, fromBase64, SIM_VERSION, toBase64 } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type WebSocket from 'ws';
import { createAdminViaCli, get, ORIGIN, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Watching a solo run live (plan «escáner pro», part G): only the run's player streams it, only staff watch it, the
// panel lists it, and its finish ends the feed for whoever was watching.

let clock = new Date('2026-11-12T10:00:00Z');
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('sol'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen')) }, { cookie });
  return { cookie, username: (res.json() as { username?: string }).username };
}

async function staff(role: 'moderator' | 'admin') {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  return { cookie: sessionCookie(res), username };
}

const startRun = async (cookie: string) =>
  (await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json() as RunStart;

async function socket<T>(path: string, cookie: string) {
  const got: T[] = [];
  const ws: WebSocket = await ctx.app.injectWS(path, { headers: { origin: ORIGIN, cookie: `gs_sid=${cookie}` } });
  const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
  ws.on('message', (data) => got.push(JSON.parse(String(data)) as T));
  return { ws, got, closed, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

const waitFor = async (ok: () => boolean, ms = 4000) => {
  const until = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > until) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe('el directo de una incursión en solitario', () => {
  test('el jugador la emite, el equipo la mira y la lista la enseña; al guardarse, termina', async () => {
    const p = await player();
    const run = await startRun(p.cookie);
    const stream = await socket<SoloStreamServerMessage>(`/galaxy/api/runs/stream/ws?run=${run.id}`, p.cookie);
    await waitFor(() => stream.got.length > 0);
    expect(stream.got[0]).toEqual({ t: 'hello', have: 0, tick: 0, watched: false });

    const mod = await staff('moderator');
    const watch = await socket<SoloWatchMessage>(`/galaxy/api/admin/solo/watch/ws?run=${run.id}`, mod.cookie);
    await waitFor(() => watch.got.length > 0);
    const hello = watch.got[0] as Extract<SoloWatchMessage, { t: 'hello' }>;
    expect(hello).toMatchObject({ t: 'hello', run: { id: run.id }, start: { sector: 'outer-nebula', probe: 'lumen', seed: run.seed }, to: 0, s: 'run' });
    expect(decodeLog(fromBase64(hello.log)).events).toEqual([]);
    await waitFor(() => stream.got.some((m) => m.t === 'watch'));
    expect(stream.got.at(-1)).toEqual({ t: 'watch', on: true });

    const events = [1, 0, 0, 127, 0, -1, 300, 0, 0, 0, 0, -1];
    const piece = encodeEvents(events, 0);
    stream.send({ t: 'f', at: 0, b: toBase64(piece.bytes), to: 320, s: 'run' });
    await waitFor(() => watch.got.length > 1);
    expect(watch.got[1]).toEqual({ t: 'f', b: toBase64(piece.bytes), to: 320, s: 'run' });

    const live = (await get(ctx.app, '/galaxy/api/admin/solo/live', { cookie: mod.cookie })).json() as SoloLiveList;
    expect(live.runs.find((r) => r.runId === run.id)).toMatchObject({ sector: 'outer-nebula', probe: 'lumen', tick: 320, state: 'run', watchers: 1 });
    expect((await get(ctx.app, '/galaxy/api/admin/solo/live', { cookie: p.cookie })).statusCode).toBe(403);

    clock = new Date(clock.getTime() + 7 * 60_000);
    const done = await post(
      ctx.app,
      `/galaxy/api/runs/${run.id}/finish`,
      { outcome: 'died', ticks: 320, depth: 1, kills: 0, bossKills: 0, level: 1, loot: [{ coins: 0, dust: 0 }], hash: '0123456789abcdef', inputs: toBase64(encodeLog({ probes: 1, events })) },
      { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } },
    );
    expect(done.statusCode, done.body).toBe(200);
    await waitFor(() => watch.got.some((m) => m.t === 'end'));
    expect(await watch.closed).toBe(1000);
    expect(await stream.closed).toBe(1000);
    expect(((await get(ctx.app, '/galaxy/api/admin/solo/live', { cookie: mod.cookie })).json() as SoloLiveList).runs.map((r) => r.runId)).not.toContain(run.id);

    // A saved run streams no more.
    const again = await socket(`/galaxy/api/runs/stream/ws?run=${run.id}`, p.cookie);
    expect(await again.closed).toBe(4404);
  });

  test('solo emite el dueño, y solo mira el equipo', async () => {
    const p = await player();
    const other = await player();
    const run = await startRun(p.cookie);
    const stranger = await socket(`/galaxy/api/runs/stream/ws?run=${run.id}`, other.cookie);
    expect(await stranger.closed).toBe(4404);
    // Nobody streams it yet: there is nothing to watch.
    const admin = await staff('admin');
    const early = await socket(`/galaxy/api/admin/solo/watch/ws?run=${run.id}`, admin.cookie);
    expect(await early.closed).toBe(4404);
    const stream = await socket<SoloStreamServerMessage>(`/galaxy/api/runs/stream/ws?run=${run.id}`, p.cookie);
    await waitFor(() => stream.got.length > 0);
    const peek = await socket(`/galaxy/api/admin/solo/watch/ws?run=${run.id}`, other.cookie);
    expect(await peek.closed).toBe(4403);
    stream.ws.close();
  });
});
