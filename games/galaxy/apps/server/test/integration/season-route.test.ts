import { randomBytes, randomUUID } from 'node:crypto';
import { PROBE_TEST, type SeasonView, type Wallet } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { invalidateLeaderboard } from '../../src/social/leaderboard';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The season route and shop (GDD §11.1, §13.1; M7d-1): steps by score, once each; the shop up to each limit with the
// season currency; once the season closes, what is left becomes dust. Its own season (a random id) so the score is ours.
const season = `t-${randomBytes(4).toString('hex')}`;
const open = { id: season, name: 'Prueba', startsAt: new Date(Date.now() - 3_600_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() };
const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, shards: 0, title: null, frame: null, ...x });
const overrides: Record<string, unknown> = {
  season: open,
  seasonRoute: {
    currency: { name: 'Esquirlas', perPoint: 0.5, dustRate: 2 },
    steps: [
      { at: 100, reward: r({ shards: 50, title: 'Pionero de prueba' }) },
      { at: 1000, reward: r({ coins: 10 }) },
    ],
    shop: [{ id: 'bag', name: 'Saco', price: 40, limit: 1, reward: r({ dust: 100 }) }],
  },
};
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig(overrides) });
});
afterAll(() => ctx.close());

test('los escalones se recogen una vez con la puntuación, la tienda vende hasta su límite y al cerrar lo que sobra pasa a polvo', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('ssn'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  const k = () => ({ cookie, headers: { 'idempotency-key': randomUUID() } });

  const first = (await get(ctx.app, '/galaxy/api/season', { cookie })).json() as SeasonView;
  expect(first).toMatchObject({ season: { id: season }, score: 0, currency: { name: 'Esquirlas', balance: 0 } });
  expect(first.steps.map((s) => s.reached)).toEqual([false, false]);
  expect((await post(ctx.app, '/galaxy/api/season/route/100/claim', undefined, k())).json()).toEqual({ error: 'mission_not_ready' });

  await ctx.db.insertInto('galaxy.season_adjustments').values({ account_id: id, season, points: 300 }).execute();
  invalidateLeaderboard();
  const claim = await post(ctx.app, '/galaxy/api/season/route/100/claim', undefined, k());
  expect(claim.statusCode).toBe(200);
  expect((claim.json() as SeasonView)).toMatchObject({ score: 300, currency: { balance: 50 }, steps: [{ at: 100, claimed: true }, { at: 1000, reached: false }] });
  expect((await post(ctx.app, '/galaxy/api/season/route/100/claim', undefined, k())).json()).toEqual({ error: 'already_claimed' });
  expect((await post(ctx.app, '/galaxy/api/season/route/1000/claim', undefined, k())).json()).toEqual({ error: 'mission_not_ready' });
  expect((await post(ctx.app, '/galaxy/api/season/route/7/claim', undefined, k())).json()).toEqual({ error: 'season_step_not_found' });
  const titles = await ctx.db.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', id).execute();
  expect(titles.map((t) => t.value)).toContain('Pionero de prueba');

  const dust0 = ((await get(ctx.app, '/galaxy/api/gacha', { cookie })).json() as { wallet: Wallet }).wallet.dust;
  const buy = await post(ctx.app, '/galaxy/api/season/shop/bag/buy', undefined, k());
  expect(buy.statusCode).toBe(200);
  expect((buy.json() as SeasonView)).toMatchObject({ currency: { balance: 10 }, shop: [{ id: 'bag', bought: 1 }] });
  expect((await post(ctx.app, '/galaxy/api/season/shop/bag/buy', undefined, k())).json()).toEqual({ error: 'season_item_sold_out' });
  const wallet = ((await get(ctx.app, '/galaxy/api/gacha', { cookie })).json() as { wallet: Wallet }).wallet;
  expect(wallet.dust).toBe(dust0 + 100);
  expect(Object.keys(wallet).some((c) => c.startsWith('season:'))).toBe(false);

  // The season closes: the 10 left become 20 dust, once.
  overrides.season = { ...open, startsAt: new Date(Date.now() - 7_200_000).toISOString(), endsAt: new Date(Date.now() - 60_000).toISOString() };
  const closed = (await get(ctx.app, '/galaxy/api/season', { cookie })).json() as SeasonView;
  expect(closed).toMatchObject({ season: null, steps: [], shop: [] });
  await get(ctx.app, '/galaxy/api/season', { cookie });
  expect(((await get(ctx.app, '/galaxy/api/gacha', { cookie })).json() as { wallet: Wallet }).wallet.dust).toBe(dust0 + 120);
  expect((await post(ctx.app, '/galaxy/api/season/shop/bag/buy', undefined, k())).json()).toEqual({ error: 'season_closed' });
  overrides.season = open;
});
