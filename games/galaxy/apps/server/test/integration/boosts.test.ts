import { randomUUID } from 'node:crypto';
import { type FinishRunRequest, parseConfig, PROBE_TEST, type RunResult, type RunStart, runPayout } from '@galaxy/shared';
import { encodeLog, SIM_VERSION, toBase64 } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Temporary global multipliers on the server (GDD §16.3; M6d-5): a run that finishes inside a boost's window is paid
// with it (before the per-run caps), says so in its breakdown, and the boosts running now are public to players.

let clock = new Date(Date.now() - 2 * 3_600_000);
const windowOf = (fromMin: number, toMin: number) => ({ startsAt: new Date(clock.getTime() + fromMin * 60_000).toISOString(), endsAt: new Date(clock.getTime() + toMin * 60_000).toISOString() });
const BOOSTS = {
  list: [
    { id: 'polvo', name: 'Doble polvo', currency: 'dust', factor: 2, ...windowOf(-60, 600) },
    { id: 'pasado', name: 'Monedas de ayer', currency: 'coins', factor: 3, ...windowOf(-600, -60) },
  ],
};
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock, config: fixedConfig({ boosts: BOOSTS }) });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('bst'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen')) }, { cookie });
  return cookie;
}

const INPUTS = toBase64(encodeLog({ probes: 1, events: [1, 0, 0, 127, 0, -1, 300, 0, 0, 0, 0, -1] }));
const claim = (over: Partial<FinishRunRequest> = {}): FinishRunRequest => ({
  outcome: 'extracted',
  ticks: 6 * 3600,
  depth: 1,
  kills: 600,
  bossKills: 1,
  level: 14,
  loot: [{ coins: 40, dust: 12 }],
  hash: '0123456789abcdef',
  inputs: INPUTS,
  ...over,
});

async function played(cookie: string, body: FinishRunRequest): Promise<RunResult> {
  const start = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  const run = start.json() as RunStart;
  clock = new Date(clock.getTime() + 7 * 60_000);
  const res = await post(ctx.app, `/galaxy/api/runs/${run.id}/finish`, body, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(res.statusCode).toBe(200);
  return res.json() as RunResult;
}

test('una partida que termina con doble polvo cobra el doble de polvo y lo dice', async () => {
  const cookie = await player();
  const r = await played(cookie, claim());
  const plain = runPayout({ ...claim(), outcome: 'extracted' }, parseConfig('runs', {}), 1);
  expect(r.payout.dust).toBe(plain.dust * 2);
  // The boost that ended before does not pay.
  expect(r.payout.coins).toBe(plain.coins);
  expect(r.breakdown.boosts).toEqual([{ id: 'polvo', name: 'Doble polvo', currency: 'dust', factor: 2 }]);
});

test('GET /boosts da los que corren ahora', async () => {
  const cookie = await player();
  const res = await get(ctx.app, '/galaxy/api/boosts', { cookie });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ boosts: [{ id: 'polvo', name: 'Doble polvo', currency: 'dust', factor: 2, endsAt: BOOSTS.list[0]!.endsAt }] });
  expect((await get(ctx.app, '/galaxy/api/boosts')).statusCode).toBe(401);
});
