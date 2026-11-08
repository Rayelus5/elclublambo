import { randomBytes, randomUUID } from 'node:crypto';
import { type HallOfFame, PROBE_TEST, type SeasonHistory, type SeasonView, type Wallet } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Closing a season (GDD §13.1; M7d-2): once it has ended, the first read archives it; each place keeps its tier's reward
// and, on the podium, the podium's; each is collected once; the hall of fame and the profile show it. A random past
// minute with no runs, so only the points given here rank.
const id = `c-${randomBytes(4).toString('hex')}`;
const start = Date.UTC(2025, 0, 1) + Math.floor(Math.random() * 300 * 86_400_000);
const season = { id, name: 'Temporada de prueba', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60_000).toISOString() };
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ season }) });
});
afterAll(() => ctx.close());

async function player(points: number) {
  const username = uniqueName('scl');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const accountId = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await ctx.db.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season: id, points }).execute();
  return { username, cookie, accountId };
}

test('al cerrar, cada puesto guarda su premio por tramo y el podio el suyo; se recogen una vez y quedan en el salón de la fama', async () => {
  const [first, second, third, fourth] = [await player(7000), await player(3000), await player(600), await player(100)];
  const view = (await get(ctx.app, '/galaxy/api/season', { cookie: first.cookie })).json() as SeasonView;
  expect(view.season).toBeNull();
  expect(view.closing).toMatchObject({ season: id, rank: 1, score: 7000, tier: 'gold', podium: true, claimed: false });
  expect(view.closing!.rewards).toHaveLength(2);
  expect((await get(ctx.app, '/galaxy/api/season', { cookie: fourth.cookie })).json()).toMatchObject({ closing: null });

  const wallet = async (cookie: string) => ((await get(ctx.app, '/galaxy/api/gacha', { cookie })).json() as { wallet: Wallet }).wallet;
  const coins0 = (await wallet(third.cookie)).coins;
  const claim = await post(ctx.app, `/galaxy/api/season/results/${id}/claim`, undefined, { cookie: third.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(claim.statusCode).toBe(200);
  expect((claim.json() as SeasonView).closing).toBeNull();
  // Bronce (500 coins) and the podium (no coins): its title and the Corona frame.
  expect((await wallet(third.cookie)).coins).toBe(coins0 + 500);
  const cosmetics = await ctx.db.selectFrom('galaxy.cosmetics').select(['kind', 'value']).where('account_id', '=', third.accountId).execute();
  expect(cosmetics).toEqual(expect.arrayContaining([{ kind: 'title', value: 'Podio de temporada' }, { kind: 'frame', value: 'crown' }]));
  expect((await post(ctx.app, `/galaxy/api/season/results/${id}/claim`, undefined, { cookie: third.cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'already_claimed' });
  expect((await post(ctx.app, '/galaxy/api/season/results/no-existe/claim', undefined, { cookie: third.cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'season_result_not_found' });

  const hall = (await get(ctx.app, '/galaxy/api/hall-of-fame', { cookie: fourth.cookie })).json() as HallOfFame;
  const mine = hall.seasons.find((s) => s.season === id)!;
  expect(mine).toMatchObject({ name: 'Temporada de prueba', players: 4 });
  expect(mine.podium.map((p) => [p.rank, p.username])).toEqual([[1, first.username], [2, second.username], [3, third.username]]);
  const history = (await get(ctx.app, `/galaxy/api/profiles/${second.username}/seasons`, { cookie: fourth.cookie })).json() as SeasonHistory;
  expect(history.seasons).toEqual([{ season: id, name: 'Temporada de prueba', endsAt: season.endsAt, rank: 2, score: 3000, tier: 'silver', podium: true }]);
});
