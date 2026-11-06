import { randomUUID } from 'node:crypto';
import { generateGalaxy, type GachaView, type PullResponse } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { inTransaction } from '../../src/db/tx';
import { credit, getWallet } from '../../src/economy/wallet';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// GDD §9 deep scan on the server: welcome, payment (coins, signals, the daily free pull), luck and guarantee, event
// banners, idempotency, audit. Each test uses its own account.
const PULL = '/galaxy/api/gacha/pull';
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player(app = ctx.app) {
  const res = await post(app, '/galaxy/api/auth/register', { username: uniqueName('scan'), password: 'una-clave-larga' });
  expect(res.statusCode).toBe(201);
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}
const pull = (cookie: string, body: object, key: string = randomUUID(), app = ctx.app) =>
  post(app, PULL, body, { cookie, headers: { 'idempotency-key': key } });
const view = async (cookie: string, app = ctx.app) => (await get(app, '/galaxy/api/gacha', { cookie })).json() as GachaView;
const grantCoins = (id: string, n: number) => inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', n, 'prueba'));

test('la primera visita da 10 señales de bienvenida, una sola vez, y muestra probabilidades y garantía', async () => {
  const { cookie, id } = await player();
  const first = await view(cookie);
  const second = await view(cookie);
  expect(first.wallet.signal).toBe(10);
  expect(second.wallet.signal).toBe(10);
  const banner = first.banners[0]!;
  expect(banner).toMatchObject({ id: 'deep-scan', welcome: true, sinceLegendary: 0, untilGuarantee: 10 });
  expect(banner.nextRates.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  expect(first.freePullAvailable).toBe(true);
  const welcome = await ctx.db.selectFrom('galaxy.ledger').select('id').where('account_id', '=', id).where('reason', '=', 'welcome').execute();
  expect(welcome).toHaveLength(1);
});

test('x1 y x10 cobran lo justo y cada galaxia queda en la colección', async () => {
  const { cookie, id } = await player();
  await grantCoins(id, 1000);
  const one = await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'coins' });
  expect(one.statusCode).toBe(200);
  expect((one.json() as PullResponse).wallet.coins).toBe(900);
  const ten = await pull(cookie, { banner: 'deep-scan', count: 10, pay: 'coins' });
  const body = ten.json() as PullResponse;
  expect(body.pulls).toHaveLength(10);
  expect(body.wallet.coins).toBe(0);
  const owned = await ctx.db.selectFrom('galaxy.galaxies').select('id').where('owner_id', '=', id).execute();
  expect(owned).toHaveLength(11);
  const signals = await pull(cookie, { banner: 'deep-scan', count: 10, pay: 'signal' });
  expect((signals.json() as PullResponse).wallet.signal).toBe(0); // the 10 welcome signals
});

test('sin saldo es 402 y no cambia nada', async () => {
  const { cookie, id } = await player();
  const res = await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'coins' });
  expect(res.statusCode).toBe(402);
  expect(res.json()).toEqual({ error: 'insufficient_funds' });
  expect(await ctx.db.selectFrom('galaxy.galaxies').select('id').where('owner_id', '=', id).execute()).toHaveLength(0);
  expect(await ctx.db.selectFrom('galaxy.gacha_pulls').select('id').where('account_id', '=', id).execute()).toHaveLength(0);
});

test('la tirada gratis es una al día de Madrid (Review Focus 2)', async () => {
  const today = new Date('2026-11-07T22:59:00Z'); // 23:59 in Madrid
  const tomorrow = new Date('2026-11-07T23:01:00Z'); // 00:01 in Madrid
  const a = await testApp({ now: () => today });
  const b = await testApp({ now: () => tomorrow });
  try {
    const { cookie } = await player(a.app);
    expect((await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'free' }, randomUUID(), a.app)).statusCode).toBe(200);
    const again = await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'free' }, randomUUID(), a.app);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'free_pull_used' });
    expect((await view(cookie, a.app)).freePullAvailable).toBe(false);
    expect((await view(cookie, b.app)).freePullAvailable).toBe(true);
    expect((await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'free' }, randomUUID(), b.app)).statusCode).toBe(200);
    expect((await pull(cookie, { banner: 'deep-scan', count: 10, pay: 'free' }, randomUUID(), b.app)).statusCode).toBe(400);
  } finally {
    await a.close();
    await b.close();
  }
});

test('tras 19 tiradas sin Legendaria, la 20 es Legendaria y el contador vuelve a 0 (Review Focus 2)', async () => {
  const { cookie, id } = await player();
  await view(cookie); // creates the luck state with the welcome
  await ctx.db.updateTable('galaxy.gacha_state').set({ since_legendary: 19, welcome: false }).where('account_id', '=', id).execute();
  await grantCoins(id, 100);
  const res = (await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'coins' })).json() as PullResponse;
  expect(res.pulls[0]!.tier).toBe('legendary');
  expect(res.pulls[0]!.traits['phenomenon']).not.toBe('none');
  expect(res.view.banners[0]).toMatchObject({ sinceLegendary: 0, untilGuarantee: 20, welcome: false });
});

test('repetir la misma clave devuelve la misma tirada y cobra una vez (Review Focus 1)', async () => {
  const { cookie, id } = await player();
  await grantCoins(id, 300);
  const key = randomUUID();
  const a = (await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'coins' }, key)).json() as PullResponse;
  const b = (await pull(cookie, { banner: 'deep-scan', count: 1, pay: 'coins' }, key)).json() as PullResponse;
  expect(b.pulls).toEqual(a.pulls);
  expect((await getWallet(ctx.db, id)).coins).toBe(200);
  const other = await pull(cookie, { banner: 'deep-scan', count: 10, pay: 'coins' }, key);
  expect(other.statusCode).toBe(409);
  expect(other.json()).toEqual({ error: 'idempotency_conflict' });
  const none = await post(ctx.app, PULL, { banner: 'deep-scan', count: 1, pay: 'coins' }, { cookie });
  expect(none.statusCode).toBe(400);
  expect(none.json()).toEqual({ error: 'idempotency_required' });
});

test('5 tiradas a la vez con saldo para 3: pasan exactamente 3 (Review Focus 1)', async () => {
  const { cookie, id } = await player();
  await grantCoins(id, 300);
  const results = await Promise.all(Array.from({ length: 5 }, () => pull(cookie, { banner: 'deep-scan', count: 1, pay: 'coins' })));
  expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
  expect(results.filter((r) => r.statusCode === 402)).toHaveLength(2);
  expect((await getWallet(ctx.db, id)).coins).toBe(0);
  const state = await ctx.db.selectFrom('galaxy.gacha_state').selectAll().where('account_id', '=', id).executeTakeFirstOrThrow();
  expect(state.total_pulls).toBe(3);
});

test('cada tirada auditada reproduce su galaxia desde la semilla de la tirada (Review Focus 3)', async () => {
  const { cookie, id } = await player();
  await grantCoins(id, 900);
  await pull(cookie, { banner: 'deep-scan', count: 10, pay: 'coins' });
  const rows = await ctx.db
    .selectFrom('galaxy.gacha_pulls as p')
    .innerJoin('galaxy.galaxies as g', 'g.id', 'p.galaxy_id')
    .select(['p.seed as pullSeed', 'p.tier', 'p.engine_version', 'g.seed as galaxySeed', 'g.dna', 'g.name'])
    .where('p.account_id', '=', id)
    .execute();
  expect(rows).toHaveLength(10);
  for (const r of rows) {
    const g = generateGalaxy(BigInt(r.pullSeed), r.tier);
    expect(g.seed.toString()).toBe(r.galaxySeed);
    expect(g.dna).toBe(r.dna);
    expect(g.name).toBe(r.name);
    expect(r.engine_version).toBe('1.0.0');
  }
});

test('el gachapón apagado responde 503 y un banner cerrado o desconocido 409', async () => {
  const off = await testApp({ config: fixedConfig({ features: { gacha: false } }) });
  const past = {
    banners: [
      { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' },
      {
        id: 'nova',
        kind: 'event',
        name: 'Semana nova',
        pityGroup: 'event-nova',
        currency: 'signal:nova',
        featured: { trait: 'phenomenon', value: 'supernova' },
        endsAt: '2026-01-01T00:00:00Z',
      },
    ],
  };
  const closed = await testApp({ config: fixedConfig({ gacha: past }) });
  try {
    const p = await player(off.app);
    expect((await get(off.app, '/galaxy/api/gacha', { cookie: p.cookie })).statusCode).toBe(503);
    const res = await pull(p.cookie, { banner: 'deep-scan', count: 1, pay: 'signal' }, randomUUID(), off.app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'gacha_disabled' });
    const q = await player(closed.app);
    expect((await view(q.cookie, closed.app)).banners.map((b) => b.id)).toEqual(['deep-scan']);
    for (const banner of ['nova', 'nope']) {
      const r = await pull(q.cookie, { banner, count: 1, pay: 'signal' }, randomUUID(), closed.app);
      expect(r.statusCode).toBe(409);
      expect(r.json()).toEqual({ error: 'banner_closed' });
    }
  } finally {
    await off.close();
    await closed.close();
  }
});

test('un banner de evento cobra sus propias señales y lleva su propio contador', async () => {
  const event = {
    banners: [
      { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' },
      {
        id: 'nova',
        kind: 'event',
        name: 'Semana nova',
        pityGroup: 'event-nova',
        currency: 'signal:nova',
        featured: { trait: 'phenomenon', value: 'supernova' },
      },
    ],
  };
  const app = await testApp({ config: fixedConfig({ gacha: event }) });
  try {
    const { cookie, id } = await player(app.app);
    await view(cookie, app.app);
    expect((await pull(cookie, { banner: 'nova', count: 1, pay: 'signal' }, randomUUID(), app.app)).statusCode).toBe(402);
    await inTransaction(ctx.db, (trx) => credit(trx, id, 'signal:nova', 2, 'prueba'));
    const res = (await pull(cookie, { banner: 'nova', count: 1, pay: 'signal' }, randomUUID(), app.app)).json() as PullResponse;
    expect(res.wallet['signal:nova']).toBe(1);
    expect(res.wallet.signal).toBe(10); // the welcome signals are not spent on the event
    const groups = await ctx.db.selectFrom('galaxy.gacha_state').select(['pity_group', 'total_pulls']).where('account_id', '=', id).orderBy('pity_group').execute();
    expect(groups).toEqual([
      { pity_group: 'event-nova', total_pulls: 1 },
      { pity_group: 'standard', total_pulls: 0 },
    ]);
    const banner = res.view.banners.find((b) => b.id === 'nova')!;
    expect(banner.untilFeatured).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
