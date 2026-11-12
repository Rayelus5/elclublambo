import { randomUUID } from 'node:crypto';
import { type MissionsView, PROBE_TEST } from '@galaxy/shared';
import { SIM_VERSION, encodeLog, toBase64 } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, openLive, post, put, sessionCookie, settle, testApp, uniqueName } from '../helpers';

// Missions and achievements (GDD §12.3; M7a): a run counts, collecting pays once, achievements unlock titles.
let clock = new Date(Date.now() - 2 * 3_600_000);
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('msn'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen')) }, { cookie });
  return cookie;
}
const view = async (cookie: string) => (await get(ctx.app, '/galaxy/api/missions', { cookie })).json() as MissionsView;
const INPUTS = toBase64(encodeLog({ probes: 1, events: [1, 0, 0, 127, 0, -1, 300, 0, 0, 0, 0, -1] }));

async function run(cookie: string) {
  const start = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  clock = new Date(clock.getTime() + 3 * 60_000);
  const body = { outcome: 'died', ticks: 2 * 3600, depth: 1, kills: 120, bossKills: 0, level: 4, loot: [{ coins: 10, dust: 3 }], hash: '0123456789abcdef', inputs: INPUTS };
  expect((await post(ctx.app, `/galaxy/api/runs/${start.json().id}/finish`, body, { cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
}

test('una partida cuenta para el logro de la primera incursión, que se recoge una vez y da su título', async () => {
  const cookie = await player();
  await run(cookie);
  const v = await view(cookie);
  const first = v.achievements.find((a) => a.id === 'a-first-run')!;
  expect(first).toMatchObject({ unlocked: true, claimed: false, progress: 1 });
  expect(v.ready).toBeGreaterThanOrEqual(1);
  const claim = await post(ctx.app, '/galaxy/api/achievements/a-first-run/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(claim.statusCode).toBe(200);
  expect((claim.json() as MissionsView).cosmetics.titles).toContain('Cadete');
  expect((await post(ctx.app, '/galaxy/api/achievements/a-first-run/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toMatchObject({ error: 'already_claimed' });
  // The title shows on the profile once chosen.
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { title: 'Cadete', frame: null }, { cookie })).statusCode).toBe(200);
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { title: 'Leyenda del ECN', frame: null }, { cookie })).json()).toMatchObject({ error: 'cosmetic_locked' });
});

test('las misiones del día son las mismas para dos cuentas y una sin completar no se recoge', async () => {
  const [a, b] = [await player(), await player()];
  const [va, vb] = [await view(a), await view(b)];
  expect(va.daily.missions.map((m) => m.id)).toEqual(vb.daily.missions.map((m) => m.id));
  expect(va.daily.missions).toHaveLength(3);
  const m = va.daily.missions[0]!;
  expect((await post(ctx.app, `/galaxy/api/missions/${va.daily.period}/${m.id}/claim`, undefined, { cookie: a, headers: { 'idempotency-key': randomUUID() } })).json()).toMatchObject({ error: 'mission_not_ready' });
});

test('un logro que se desbloquea avisa al momento, una sola vez', async () => {
  const cookie = await player();
  const live = await openLive(ctx.app, cookie);
  await run(cookie);
  await run(cookie);
  await settle();
  const first = live.notices().filter((n) => n.kind === 'achievement' && n.id === 'a-first-run');
  expect(first).toEqual([{ kind: 'achievement', id: 'a-first-run', name: 'Primer despegue', tier: 'bronze' }]);
  live.ws.terminate();
});
