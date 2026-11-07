import { randomUUID } from 'node:crypto';
import { type HangarView, parseConfig, PROBE_TEST, probeLevelBonuses, type RunStart } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Probe levels and starting weapons on the server (GDD §6, M4b-1): a level is bought with components and coins in an
// idempotent operation that names the level it buys; the variant is chosen once its level opens it; every run starts
// with the level's bonuses and the variant, snapshotted.

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

const cfg = parseConfig('probes', {});

/** A new account whose test gave Lumen. */
async function lumenPlayer() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('lvl'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const answers = PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never));
  expect((await post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie })).statusCode).toBe(200);
  return { cookie, id: (res.json() as { id: string }).id };
}
const hangar = async (cookie: string) => (await get(ctx.app, '/galaxy/api/hangar', { cookie })).json() as HangarView;
const lumenOf = (v: HangarView) => v.probes.find((p) => p.id === 'lumen')!;
const levelUp = (cookie: string, probe: string, level: unknown, key = randomUUID()) =>
  post(ctx.app, `/galaxy/api/hangar/probes/${probe}/level-up`, { level }, { cookie, headers: { 'idempotency-key': key } });
const choose = (cookie: string, probe: string, variant: string) => put(ctx.app, `/galaxy/api/hangar/probes/${probe}/variant`, { variant }, { cookie });
const startRun = (cookie: string) =>
  post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });

/** Components and coins for every level from 2 up to `to`. */
async function fund(id: string, to: number) {
  const costs = cfg.levels.costs.slice(0, to - 1);
  await credit(ctx.db, id, 'components', costs.reduce((a, c) => a + c.components, 0), 'test');
  await credit(ctx.db, id, 'coins', costs.reduce((a, c) => a + c.coins, 0), 'test');
}
async function levelTo(cookie: string, to: number) {
  for (let level = 2; level <= to; level++) expect((await levelUp(cookie, 'lumen', level)).statusCode).toBe(200);
}

test('subir la sonda de la prueba al nivel 2 cuesta 20 componentes y 300 monedas, y el Hangar lo enseña', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 2);
  const before = await getWallet(ctx.db, id);
  const res = await levelUp(cookie, 'lumen', 2);
  expect(res.statusCode).toBe(200);
  const lumen = lumenOf(res.json() as HangarView);
  expect(lumen).toMatchObject({ level: 2, maxLevel: 10, next: { components: 35, coins: 600 }, bonuses: probeLevelBonuses(2, cfg) });
  const after = await getWallet(ctx.db, id);
  expect(before['components']! - (after['components'] ?? 0)).toBe(20);
  expect(before.coins - after.coins).toBe(300);
  expect(lumenOf(await hangar(cookie)).level).toBe(2);
});

test('sin fondos, 402 y nada cambia', async () => {
  const { cookie } = await lumenPlayer();
  const res = await levelUp(cookie, 'lumen', 2);
  expect(res.statusCode).toBe(402);
  expect(res.json()).toEqual({ error: 'insufficient_funds' });
  expect(lumenOf(await hangar(cookie)).level).toBe(1);
});

test('una vista vieja da probe_changed y no cobra', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 3);
  expect((await levelUp(cookie, 'lumen', 2)).statusCode).toBe(200);
  const before = await getWallet(ctx.db, id);
  const stale = await levelUp(cookie, 'lumen', 2);
  expect(stale.statusCode).toBe(409);
  expect(stale.json()).toEqual({ error: 'probe_changed' });
  expect(await getWallet(ctx.db, id)).toEqual(before);
  expect(lumenOf(await hangar(cookie)).level).toBe(2);
});

test('una clave repetida devuelve lo mismo y cobra una vez', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 3);
  const before = await getWallet(ctx.db, id);
  const key = randomUUID();
  const a = await levelUp(cookie, 'lumen', 2, key);
  const b = await levelUp(cookie, 'lumen', 2, key);
  expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
  expect(lumenOf(b.json() as HangarView).level).toBe(2);
  expect(before['components']! - (await getWallet(ctx.db, id))['components']!).toBe(20);
});

test('dos subidas a la vez con claves distintas al mismo nivel: una pasa y la otra da probe_changed', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 3);
  const before = await getWallet(ctx.db, id);
  const both = await Promise.all([levelUp(cookie, 'lumen', 2), levelUp(cookie, 'lumen', 2)]);
  expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  const after = await getWallet(ctx.db, id);
  expect(before['components']! - after['components']!).toBe(20);
  expect(before.coins - after.coins).toBe(300);
});

test('una sonda sin desbloquear da probe_locked y una que no existe, 400', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 2);
  const before = await getWallet(ctx.db, id);
  const locked = await levelUp(cookie, 'echo', 2);
  expect(locked.statusCode).toBe(409);
  expect(locked.json()).toEqual({ error: 'probe_locked' });
  expect((await levelUp(cookie, 'nobody', 2)).statusCode).toBe(400);
  expect(await getWallet(ctx.db, id)).toEqual(before);
});

test('al nivel 10, probe_maxed', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 10);
  await levelTo(cookie, 10);
  const lumen = lumenOf(await hangar(cookie));
  expect(lumen).toMatchObject({ level: 10, next: null });
  const max = await levelUp(cookie, 'lumen', 11);
  expect(max.statusCode).toBe(409);
  expect(max.json()).toEqual({ error: 'probe_maxed' });
});

test('la variante del nivel 4: cerrada en el 3, elegible en el 4, y volver a la base guarda null', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 4);
  await levelTo(cookie, 3);
  const early = await choose(cookie, 'lumen', 'pulse-twin');
  expect(early.statusCode).toBe(409);
  expect(early.json()).toEqual({ error: 'variant_locked' });
  expect((await levelUp(cookie, 'lumen', 4)).statusCode).toBe(200);
  const chosen = await choose(cookie, 'lumen', 'pulse-twin');
  expect(chosen.statusCode).toBe(200);
  expect(lumenOf(chosen.json() as HangarView).variant).toBe('pulse-twin');
  const back = await choose(cookie, 'lumen', 'pulse');
  expect(lumenOf(back.json() as HangarView).variant).toBe('pulse');
  const row = await ctx.db.selectFrom('galaxy.probe_levels').select('variant').where('account_id', '=', id).where('probe', '=', 'lumen').executeTakeFirstOrThrow();
  expect(row.variant).toBeNull();
  expect((await choose(cookie, 'lumen', 'nova-wide')).statusCode).toBe(400);
  expect((await choose(cookie, 'echo', 'turret')).statusCode).toBe(409);
});

test('la incursión sale con los bonos del nivel y la variante elegida, y los guarda', async () => {
  const { cookie, id } = await lumenPlayer();
  await fund(id, 4);
  await levelTo(cookie, 4);
  expect((await choose(cookie, 'lumen', 'pulse-twin')).statusCode).toBe(200);
  const res = await startRun(cookie);
  expect(res.statusCode).toBe(200);
  const run = res.json() as RunStart;
  expect(run.bonuses).toEqual(probeLevelBonuses(4, cfg));
  expect(run.variant).toBe('pulse-twin');
  const row = await ctx.db.selectFrom('galaxy.runs').select('upgrades').where('id', '=', run.id).executeTakeFirstOrThrow();
  expect(row.upgrades).toEqual({ bonuses: probeLevelBonuses(4, cfg), variant: 'pulse-twin' });
});

test('una variante guardada que ya no vale sale como la base', async () => {
  const { cookie, id } = await lumenPlayer();
  await ctx.db.insertInto('galaxy.probe_levels').values({ account_id: id, probe: 'lumen', level: 3, variant: 'pulse-twin' }).execute();
  const run = (await startRun(cookie)).json() as RunStart;
  expect(run.variant).toBeNull();
  expect(run.bonuses).toEqual(probeLevelBonuses(3, cfg));
  expect(lumenOf(await hangar(cookie)).variant).toBe('pulse');
});

test('sin sesión, 401 antes que validar el cuerpo', async () => {
  const bad = await post(ctx.app, '/galaxy/api/hangar/probes/lumen/level-up', { level: 'x' }, { headers: { 'idempotency-key': randomUUID() } });
  expect(bad.statusCode).toBe(401);
  expect((await put(ctx.app, '/galaxy/api/hangar/probes/lumen/variant', { variant: 1 })).statusCode).toBe(401);
});
