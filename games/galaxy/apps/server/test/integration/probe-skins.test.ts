import { randomUUID } from 'node:crypto';
import { type HangarView, type LiveEvent, parseConfig, PROBE_TEST, type RoomView, type RunStart, SCRAP_SKIN_RUNS } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type WebSocket from 'ws';
import { grantCosmetics, revokeCosmetic } from '../../src/cosmetics/service';
import { get, ORIGIN, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Probe skins (plan «banda sonora, skins, perfil y entorno», part C): a skin is a cosmetic; each probe wears one of the
// player's skins of that very probe, or none. The run snapshots it, the room shows it live, a refund takes it off, and
// the Chatarra skin of a probe comes with its runs.

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

const probes = parseConfig('probes', {});

/** A new account whose test gave Lumen, past the tutorial (so it may play in a group). */
async function lumenPlayer() {
  const username = uniqueName('skn');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const answers = PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never));
  expect((await post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie })).statusCode).toBe(200);
  await put(ctx.app, '/galaxy/api/tutorial', { action: 'skip' }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id, username };
}
const hangar = async (cookie: string) => (await get(ctx.app, '/galaxy/api/hangar', { cookie })).json() as HangarView;
const lumenOf = (v: HangarView) => v.probes.find((p) => p.id === 'lumen')!;
const wear = (cookie: string, probe: string, skin: string | null) => put(ctx.app, `/galaxy/api/hangar/probes/${probe}/skin`, { skin }, { cookie });

/** `n` finished, counted runs with a probe. */
async function flown(accountId: string, probe: string, n: number) {
  for (let i = 0; i < n; i++) {
    await ctx.db
      .insertInto('galaxy.runs')
      .values({ account_id: accountId, seed: '1', sector: 'outer-nebula', probe, relics: '[]', content_version: 0, sim_version: SIM_VERSION, start_key: randomUUID(), started_at: new Date(), finished_at: new Date(), outcome: 'died', ticks: 36_000, depth: 100, kills: 10, boss_kills: 0, level: 3, seconds: probes.minRunSeconds + 60, hash: '0123456789abcdef', payout: '{}', runs_version: 0, flags: [], suspicious: false })
      .execute();
  }
}

test('sin la skin no se puede poner (409) y con la de otra sonda tampoco (400)', async () => {
  const p = await lumenPlayer();
  const locked = await wear(p.cookie, 'lumen', 'skin-lumen-coral');
  expect(locked.statusCode).toBe(409);
  expect(locked.json()).toEqual({ error: 'cosmetic_locked' });
  await grantCosmetics(ctx.db, p.id, { skin: 'skin-bastion-coral' });
  const other = await wear(p.cookie, 'lumen', 'skin-bastion-coral');
  expect(other.statusCode).toBe(400);
  expect(lumenOf(await hangar(p.cookie)).skin).toBeNull();
});

test('con la skin, la sonda la lleva: el Hangar la enseña, la incursión la guarda y null la quita', async () => {
  const p = await lumenPlayer();
  await grantCosmetics(ctx.db, p.id, { skin: 'skin-lumen-coral' });
  expect(lumenOf(await hangar(p.cookie))).toMatchObject({ skin: null, skins: ['skin-lumen-coral'] });
  const res = await wear(p.cookie, 'lumen', 'skin-lumen-coral');
  expect(res.statusCode, res.body).toBe(200);
  expect(lumenOf(res.json() as HangarView).skin).toBe('skin-lumen-coral');
  // Only drawing: the run carries it in its start, and the server keeps it with the run's upgrades.
  const start = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(start.statusCode, start.body).toBe(200);
  const run = start.json() as RunStart;
  expect(run.skin).toBe('skin-lumen-coral');
  const row = await ctx.db.selectFrom('galaxy.runs').select('upgrades').where('id', '=', run.id).executeTakeFirstOrThrow();
  expect((row.upgrades as { skin?: string }).skin).toBe('skin-lumen-coral');
  expect(lumenOf((await wear(p.cookie, 'lumen', null)).json() as HangarView).skin).toBeNull();
});

test('si la skin se retira (una devolución), la sonda vuelve a su dibujo', async () => {
  const p = await lumenPlayer();
  await grantCosmetics(ctx.db, p.id, { skin: 'skin-lumen-chatarra' });
  expect((await wear(p.cookie, 'lumen', 'skin-lumen-chatarra')).statusCode).toBe(200);
  await revokeCosmetic(ctx.db, p.id, 'skin', 'skin-lumen-chatarra');
  expect(lumenOf(await hangar(p.cookie))).toMatchObject({ skin: null, skins: [] });
});

test(`la skin Chatarra de una sonda llega con ${SCRAP_SKIN_RUNS} incursiones con ella, ni una antes`, async () => {
  const p = await lumenPlayer();
  await flown(p.id, 'lumen', SCRAP_SKIN_RUNS - 1);
  expect(lumenOf(await hangar(p.cookie))).toMatchObject({ runs: SCRAP_SKIN_RUNS - 1, skins: [] });
  await flown(p.id, 'lumen', 1);
  expect(lumenOf(await hangar(p.cookie))).toMatchObject({ runs: SCRAP_SKIN_RUNS, skins: ['skin-lumen-chatarra'] });
  // Given once: reading the Hangar again changes nothing.
  const rows = await ctx.db.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', p.id).where('kind', '=', 'skin').execute();
  expect(rows).toHaveLength(1);
});

test('en la sala, los compañeros ven al momento la skin que se pone un jugador', async () => {
  const a = await lumenPlayer();
  const b = await lumenPlayer();
  const room = (await post(ctx.app, '/galaxy/api/rooms', { kind: 'public', sector: 'outer-nebula' }, { cookie: a.cookie })).json() as RoomView;
  expect((await post(ctx.app, '/galaxy/api/rooms/join', { code: room.code }, { cookie: b.cookie })).statusCode).toBe(200);
  const events: LiveEvent[] = [];
  const ws: WebSocket = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin: ORIGIN, cookie: `gs_sid=${b.cookie}` } });
  ws.on('message', (data) => events.push(JSON.parse(String(data)) as LiveEvent));
  try {
    await grantCosmetics(ctx.db, a.id, { skin: 'skin-lumen-coral' });
    expect((await wear(a.cookie, 'lumen', 'skin-lumen-coral')).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    const last = events.filter((e): e is Extract<LiveEvent, { type: 'room' }> => e.type === 'room').at(-1);
    expect(last?.room?.members.find((m) => m.username === a.username)?.skin).toBe('skin-lumen-coral');
  } finally {
    ws.terminate();
  }
});
