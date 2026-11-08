import { randomInt, randomUUID } from 'node:crypto';
import { type MissionsView, PROBE_TEST, type Wallet } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit } from '../../src/economy/wallet';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Events (GDD §13.2, §14.3; M7e-1): personal goals count like missions; a clan goal adds up its members' work and each
// member collects it once; rewards can be the event's own signals, `signal:<event>`, for its event scanner.
const id = `ev-${randomInt(1_000_000)}`;
const now = Date.now();
const r = (x: object) => ({ coins: 0, dust: 0, signal: 0, xp: 0, points: 0, eventSignals: 0, ...x });
const event = {
  id,
  name: 'Lluvia de cometas',
  description: 'Escanea el cielo mientras pasan los cometas',
  startsAt: new Date(now - 3_600_000).toISOString(),
  endsAt: new Date(now + 3_600_000).toISOString(),
  goals: [
    { id: 'scan', name: 'Haz 10 tiradas', stat: 'pulls', target: 10, scope: 'personal', reward: r({ eventSignals: 3 }) },
    { id: 'together', name: 'Entre todo el clan, 15 tiradas', stat: 'pulls', target: 15, scope: 'clan', reward: r({ coins: 500 }) },
  ],
};
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ events: { list: [event] } }) });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('evt'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const accountId = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: accountId, xp: 1000 }).execute();
  return { cookie, accountId };
}
const k = (cookie: string) => ({ cookie, headers: { 'idempotency-key': randomUUID() } });
const pull10 = async (cookie: string) => {
  await get(ctx.app, '/galaxy/api/gacha', { cookie });
  expect((await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' }, k(cookie))).statusCode).toBe(200);
};
const view = async (cookie: string) => (await get(ctx.app, '/galaxy/api/missions', { cookie })).json() as MissionsView;

test('las metas personales se cuentan y pagan señales del evento; la de clan suma a sus miembros y cada uno la recoge una vez', async () => {
  const [a, b] = [await player(), await player()];
  await pull10(a.cookie);
  const ev = (await view(a.cookie)).events[0]!;
  expect(ev).toMatchObject({ id, period: `e:${id}`, inClan: false });
  expect(ev.goals.map((g) => [g.id, g.progress])).toEqual([['scan', 10], ['together', 0]]);
  // Without a clan, a clan goal can be neither counted nor collected.
  expect((await post(ctx.app, `/galaxy/api/missions/e:${id}/together/claim`, undefined, k(a.cookie))).json()).toEqual({ error: 'not_in_clan' });
  expect((await post(ctx.app, `/galaxy/api/missions/e:${id}/scan/claim`, undefined, k(a.cookie))).statusCode).toBe(200);
  const wallet = ((await get(ctx.app, '/galaxy/api/gacha', { cookie: a.cookie })).json() as { wallet: Wallet }).wallet;
  expect(wallet[`signal:${id}`]).toBe(3);
  expect((await post(ctx.app, `/galaxy/api/missions/e:${id}/scan/claim`, undefined, k(a.cookie))).json()).toEqual({ error: 'already_claimed' });

  // A clan: a creates it, b joins; b's ten pulls and a's next ten add up for both.
  await credit(ctx.db, a.accountId, 'coins', 2000, 'test');
  const tag = randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
  expect((await post(ctx.app, '/galaxy/api/clans', { name: `Clan ${randomInt(1_000_000)}`, tag, emblem: 'comet', color: 'uv', open: true }, k(a.cookie))).statusCode).toBe(200);
  expect((await post(ctx.app, `/galaxy/api/clans/${tag}/join`, undefined, { cookie: b.cookie })).statusCode).toBe(200);
  await pull10(b.cookie);
  expect((await view(a.cookie)).events[0]!.goals.find((g) => g.id === 'together')!.progress).toBe(10);
  expect((await post(ctx.app, `/galaxy/api/missions/e:${id}/together/claim`, undefined, k(b.cookie))).json()).toEqual({ error: 'mission_not_ready' });
  await credit(ctx.db, a.accountId, 'signal', 10, 'test');
  await pull10(a.cookie);
  for (const p of [a, b]) {
    expect((await post(ctx.app, `/galaxy/api/missions/e:${id}/together/claim`, undefined, k(p.cookie))).statusCode).toBe(200);
    expect((await post(ctx.app, `/galaxy/api/missions/e:${id}/together/claim`, undefined, k(p.cookie))).json()).toEqual({ error: 'already_claimed' });
  }
});
