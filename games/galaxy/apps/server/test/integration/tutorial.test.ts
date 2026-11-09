import { PROBE_TEST, type TutorialView, type Wallet } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The guided tutorial (GDD §12.2; polish phase 3): a new account starts it; it only moves forward; reaching the station
// pays the antenna's repair once; it can be skipped and started again; an account that already played is done.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({});
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('tut'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id };
}
const view = async (cookie: string) => (await get(ctx.app, '/galaxy/api/tutorial', { cookie })).json() as TutorialView;
const send = async (cookie: string, body: object) => (await put(ctx.app, '/galaxy/api/tutorial', body, { cookie })).json() as TutorialView;
const components = async (cookie: string) => (((await get(ctx.app, '/galaxy/api/gacha', { cookie })).json() as { wallet: Wallet }).wallet['components'] ?? 0);

test('una cuenta nueva empieza el tutorial, solo avanza y al llegar a la estación recibe una vez lo de reparar la antena', async () => {
  expect((await get(ctx.app, '/galaxy/api/tutorial')).statusCode).toBe(401);
  const p = await player();
  expect(await view(p.cookie)).toEqual({ status: 'active', chapter: 'hub', gift: 0 });
  expect(await send(p.cookie, { action: 'advance', chapter: 'hangar' })).toMatchObject({ chapter: 'hangar', gift: 0 });
  // Never backwards.
  expect(await send(p.cookie, { action: 'advance', chapter: 'scanner' })).toMatchObject({ chapter: 'hangar' });
  const before = await components(p.cookie);
  const station = await send(p.cookie, { action: 'advance', chapter: 'station' });
  expect(station.chapter).toBe('station');
  expect(station.gift).toBeGreaterThan(0);
  expect(await components(p.cookie)).toBe(before + station.gift);
  expect(await send(p.cookie, { action: 'advance', chapter: 'done' })).toMatchObject({ status: 'done', chapter: 'done' });
  // Restarting replays the tour, but the gift was once in the account's life.
  expect(await send(p.cookie, { action: 'restart' })).toMatchObject({ status: 'active', chapter: 'hub' });
  await send(p.cookie, { action: 'advance', chapter: 'station' });
  expect(await components(p.cookie)).toBe(before + station.gift);
});

test('se puede saltar, y una cuenta que ya jugó no lo ve', async () => {
  const p = await player();
  expect(await send(p.cookie, { action: 'skip' })).toMatchObject({ status: 'skipped' });
  const veteran = await player();
  await ctx.db.insertInto('galaxy.tutorial').values({ account_id: veteran.id, chapter: 'done', done_at: new Date() }).onConflict((oc) => oc.doNothing()).execute();
  expect(await view(veteran.cookie)).toMatchObject({ status: 'done' });
  expect((await put(ctx.app, '/galaxy/api/tutorial', { action: 'advance', chapter: 'nope' }, { cookie: p.cookie })).statusCode).toBe(400);
});
