import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { generateGalaxy, type FinishRunRequest, type RunResult, type RunStart, type Wallet } from '@galaxy/shared';
import { DEFAULT_CONTENT, encodeLog, SIM_VERSION, toBase64 } from '@galaxy/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { madridDay } from '../../src/economy/day';
import { fixedConfig, get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Runs on the server (GDD §5.1, §11.3 bis, §14.7): the server seeds the run and snapshots the relics; the result is
// sent once, checked for plausibility and paid by depth, death share and the daily yield.

let clock = new Date('2026-11-07T10:00:00Z');
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('run'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}

let seedCounter = 1n;
async function own(owner: string, tier = 4): Promise<string> {
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 900n + seedCounter++, tier);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({
      owner_id: owner,
      seed: g.seed.toString(),
      engine_version: ENGINE_VERSION,
      traits: JSON.stringify(g.traits),
      dna: g.dna,
      name: g.name,
      designation: g.designation,
      tier,
      score: g.score,
      finish: 'normal',
      origin: 'grant',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const start = (cookie: string, key = randomUUID(), app = ctx.app) =>
  post(app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': key } });
const finish = (cookie: string, id: string, body: FinishRunRequest, key = randomUUID()) =>
  post(ctx.app, `/galaxy/api/runs/${id}/finish`, body, { cookie, headers: { 'idempotency-key': key } });
const wallet = async (cookie: string) => (await get(ctx.app, '/galaxy/api/gacha', { cookie })).json().wallet as Wallet;

const INPUTS = toBase64(encodeLog({ probes: 1, events: [1, 0, 0, 127, 0, -1, 300, 0, 0, 0, 0, -1] }));
const body = (over: Partial<FinishRunRequest> = {}): FinishRunRequest => ({
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

/** Starts a run now and moves the clock `minutes` ahead (the run's real duration). */
async function played(cookie: string, minutes: number): Promise<RunStart> {
  const res = await start(cookie);
  expect(res.statusCode).toBe(200);
  clock = new Date(clock.getTime() + minutes * 60_000);
  return res.json() as RunStart;
}

test('empezar devuelve la semilla del servidor, el contenido y la foto de las reliquias vivas', async () => {
  const { cookie, id } = await player();
  const a = await own(id);
  const b = await own(id, 1);
  await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [a, b] }, { cookie });
  // Something removes the second galaxy behind the hangar's back: it must not reach the run.
  await ctx.db.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', '=', b).execute();
  const res = await start(cookie);
  expect(res.statusCode).toBe(200);
  const run = res.json() as RunStart;
  expect(run.seed).toMatch(/^\d{1,20}$/);
  expect(BigInt(run.seed) < 1n << 64n).toBe(true);
  expect(run.sector).toBe('outer-nebula');
  expect(run.content).toEqual(DEFAULT_CONTENT);
  expect(run.relics.map((r) => r.id)).toEqual([a]);
  expect(run.relics[0]).toMatchObject({ tier: 4, level: 1, traits: expect.objectContaining({ galaxy_type: expect.any(String) }) });
  const again = await start(cookie);
  expect((again.json() as RunStart).seed).not.toBe(run.seed);
});

test('extraer paga el botín por la profundidad de cada capa, en el libro', async () => {
  const { cookie } = await player();
  const before = await wallet(cookie);
  const run = await played(cookie, 14);
  const res = await finish(cookie, run.id, body({ ticks: 13 * 3600, depth: 2, bossKills: 2, kills: 1200, loot: [{ coins: 40, dust: 12 }, { coins: 20, dust: 6 }] }));
  expect(res.statusCode).toBe(200);
  const r = res.json() as RunResult;
  expect(r.payout).toMatchObject({ coins: 40 + 30, dust: 12 + 9 });
  expect(r.breakdown.share).toBe(1);
  expect(r.breakdown.daily).toEqual([{ seconds: 13 * 60, multiplier: 1 }]);
  expect(r.wallet.coins).toBe(before.coins + 70);
  expect(r.wallet.dust).toBe(before.dust + 21);
  const ledger = await sql<{ reason: string; currency: string }>`select reason, currency from galaxy.ledger where ref @> ${JSON.stringify({ run: run.id })}::jsonb order by id`.execute(ctx.db);
  expect(ledger.rows.filter((l) => l.currency !== 'signal')).toEqual([
    { reason: 'run', currency: 'coins' },
    { reason: 'run', currency: 'dust' },
  ]);
});

test('morir o abandonar paga la mitad', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  const r = (await finish(cookie, run.id, body({ outcome: 'died', bossKills: 1, loot: [{ coins: 41, dust: 13 }] }))).json() as RunResult;
  expect(r.payout).toMatchObject({ coins: 20, dust: 6 });
  expect(r.breakdown.share).toBe(0.5);
});

test('la misma clave dos veces da el mismo resultado y paga una vez; otra clave, 409', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  const key = randomUUID();
  const first = await finish(cookie, run.id, body(), key);
  const second = await finish(cookie, run.id, body(), key);
  expect(second.statusCode).toBe(200);
  expect(second.json()).toEqual(first.json());
  expect((await wallet(cookie)).coins).toBe((first.json() as RunResult).wallet.coins);
  const other = await finish(cookie, run.id, body());
  expect(other.statusCode).toBe(409);
  expect(other.json()).toEqual({ error: 'run_finished' });
});

test('una partida ajena o inexistente → 404; caducada → 410', async () => {
  const me = await player();
  const other = await player();
  const run = await played(other.cookie, 7);
  expect((await finish(me.cookie, run.id, body())).json()).toEqual({ error: 'run_not_found' });
  expect((await finish(me.cookie, randomUUID(), body())).statusCode).toBe(404);
  const old = await played(me.cookie, 25 * 60);
  const res = await finish(me.cookie, old.id, body());
  expect(res.statusCode).toBe(410);
  expect(res.json()).toEqual({ error: 'run_expired' });
});

test('entradas rotas → 400 bad_inputs, y la partida sigue abierta', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  const garbage = await finish(cookie, run.id, body({ inputs: toBase64(new Uint8Array([9, 9, 9])) }));
  expect(garbage.statusCode).toBe(400);
  expect(garbage.json()).toEqual({ error: 'bad_inputs' });
  expect((await finish(cookie, run.id, body())).statusCode).toBe(200);
});

test('botín imposible: se paga recortado y la partida queda como sospechosa', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  const r = (await finish(cookie, run.id, body({ kills: 100, loot: [{ coins: 99_999, dust: 99_999 }] }))).json() as RunResult;
  // Topes: 100 × 0,25 + 30 + 5 = 60 monedas; 100 × 0,12 + 10 + 5 = 27 de polvo.
  expect(r.payout).toMatchObject({ coins: 60, dust: 27 });
  const row = await ctx.db.selectFrom('galaxy.runs').select(['suspicious', 'flags', 'outcome']).where('id', '=', run.id).executeTakeFirstOrThrow();
  expect(row).toMatchObject({ suspicious: true, outcome: 'extracted' });
  expect(row.flags).toContain('loot_cap');
});

test('una reclamación imposible se recorta a su tiempo real: capa 1, sin botín de capas de más', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 1);
  const loot = Array.from({ length: 999 }, (_, i) => (i === 998 ? { coins: 10_000_000, dust: 10_000_000 } : { coins: 0, dust: 0 }));
  const res = await finish(cookie, run.id, body({ ticks: 60 * 60, depth: 999, kills: 10_000_000, bossKills: 999, loot, inputs: toBase64(encodeLog({ probes: 1, events: [] })) }));
  expect(res.statusCode).toBe(200);
  const r = res.json() as RunResult;
  expect(r).toMatchObject({ depth: 1, payout: { coins: 0, dust: 0 } });
  expect(r.payout.signals).toBeLessThanOrEqual(1);
  const row = await ctx.db.selectFrom('galaxy.runs').select(['depth', 'kills', 'boss_kills', 'flags']).where('id', '=', run.id).executeTakeFirstOrThrow();
  expect(row).toMatchObject({ depth: 1, kills: 950, boss_kills: 1 });
  expect(row.flags).toEqual(expect.arrayContaining(['depth_vs_time', 'kills_rate']));
});

test('una partida con banderas de trampa cobra solo la parte de morir', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 1);
  const r = (await finish(cookie, run.id, body())).json() as RunResult;
  // 6 min de juego en 1 min real: too_fast. 40 monedas y 12 de polvo a ×0,5.
  expect(r.payout).toMatchObject({ coins: 20, dust: 6 });
  expect(r.ticks).toBe((60 + 20) * 60);
});

test('dos partidas a la vez no cobran dos veces el mismo tiempo real', async () => {
  const { cookie } = await player();
  const a = (await start(cookie)).json() as RunStart;
  const b = (await start(cookie)).json() as RunStart;
  clock = new Date(clock.getTime() + 21 * 60_000);
  const claim = body({ outcome: 'died', ticks: 20 * 3600, bossKills: 0, kills: 1200 });
  expect((await finish(cookie, a.id, claim)).json()).toMatchObject({ ticks: 20 * 3600 });
  clock = new Date(clock.getTime() + 60_000);
  const second = (await finish(cookie, b.id, claim)).json() as RunResult;
  expect(second.ticks).toBe((60 + 20) * 60);
  const row = await ctx.db.selectFrom('galaxy.runs').select('flags').where('id', '=', b.id).executeTakeFirstOrThrow();
  expect(row.flags).toContain('too_fast');
});

test('ninguna partida cobra más que el techo por partida, y queda marcada', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 61);
  const loot = Array.from({ length: 13 }, (_, i) => (i === 12 ? { coins: 9_000, dust: 4_000 } : { coins: 0, dust: 0 }));
  const r = (await finish(cookie, run.id, body({ ticks: 60 * 3600, depth: 13, bossKills: 13, kills: 36_000, loot }))).json() as RunResult;
  expect(r.payout).toMatchObject({ coins: 20_000, dust: 10_000 });
  const row = await ctx.db.selectFrom('galaxy.runs').select(['flags', 'suspicious']).where('id', '=', run.id).executeTakeFirstOrThrow();
  expect(row).toMatchObject({ flags: ['payout_cap'], suspicious: true });
});

test('entradas válidas de más de 2 MB → 400 bad_inputs, nunca 500', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  const events: number[] = [];
  for (let t = 1; t <= 341_700; t++) events.push(t, 0, 0, t % 2 === 0 ? 1 : -1, 0, -1);
  const bytes = encodeLog({ probes: 1, events });
  expect(bytes.length).toBeGreaterThan(2_000_000);
  const res = await finish(cookie, run.id, body({ inputs: toBase64(bytes) }));
  expect(res.statusCode).toBe(400);
  expect(res.json()).toEqual({ error: 'bad_inputs' });
});

test('reenviar un resultado ya cobrado no gasta el límite de envíos', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  const key = randomUUID();
  const first = await finish(cookie, run.id, body(), key);
  expect(first.statusCode).toBe(200);
  for (let k = 0; k < 61; k++) {
    const again = await finish(cookie, run.id, body(), key);
    expect(again.statusCode, `reenvío ${k + 1}`).toBe(200);
  }
});

test('con 2 h 50 min ya jugadas hoy, una partida de 20 min cobra 10 min a ×1 y 10 a ×0,75', async () => {
  const { cookie, id } = await player();
  await ctx.db.insertInto('galaxy.run_days').values({ account_id: id, day: madridDay(clock), seconds: 2 * 3600 + 50 * 60 }).execute();
  const run = await played(cookie, 21);
  const r = (await finish(cookie, run.id, body({ ticks: 20 * 3600, kills: 1200, loot: [{ coins: 100, dust: 20 }] }))).json() as RunResult;
  expect(r.breakdown.daily).toEqual([
    { seconds: 600, multiplier: 1 },
    { seconds: 600, multiplier: 0.75 },
  ]);
  expect(r.payout).toMatchObject({ coins: 87, dust: 17 });
  const day = await ctx.db.selectFrom('galaxy.run_days').select('seconds').where('account_id', '=', id).executeTakeFirstOrThrow();
  expect(day.seconds).toBe(2 * 3600 + 50 * 60 + 20 * 60);
});

test('ninguna petición rota da 500', async () => {
  const { cookie } = await player();
  const run = await played(cookie, 7);
  for (const bad of [{}, { ...body(), loot: [] }, { ...body(), outcome: 'won' }, { ...body(), inputs: 'A'.repeat(10) + '!' }]) {
    const res = await finish(cookie, run.id, bad as FinishRunRequest);
    expect(res.statusCode, JSON.stringify(bad).slice(0, 60)).toBe(400);
  }
  const noKey = await post(ctx.app, `/galaxy/api/runs/${run.id}/finish`, body(), { cookie });
  expect(noKey.statusCode).toBe(400);
  expect((await post(ctx.app, '/galaxy/api/runs/no-es-uuid/finish', body(), { cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(400);
  const wrongSector = await post(ctx.app, '/galaxy/api/runs', { sector: 'nowhere', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(wrongSector.statusCode).toBe(400);
});

test('con las incursiones apagadas: 503 runs_disabled', async () => {
  const off = await testApp({ config: fixedConfig({ features: { runs: false } }) });
  try {
    const res = await post(off.app, '/galaxy/api/auth/register', { username: uniqueName('off'), password: 'una-clave-larga' });
    const r = await start(sessionCookie(res), randomUUID(), off.app);
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'runs_disabled' });
  } finally {
    await off.close();
  }
});
