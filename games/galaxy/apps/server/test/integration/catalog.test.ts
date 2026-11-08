import { randomUUID } from 'node:crypto';
import { type CatalogView, PROBE_TEST } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The ECN Catalogue (GDD §12.3; M7b): what an account has pulled fills the album; each share's reward is collected once.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({});
});
afterAll(() => ctx.close());

test('las galaxias de las tiradas llenan el álbum, y el premio del 10 % se recoge una vez', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('cat'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  const empty = (await get(ctx.app, '/galaxy/api/catalog', { cookie })).json() as CatalogView;
  expect(empty).toMatchObject({ found: 0, total: 32, percent: 0 });
  expect((await post(ctx.app, '/galaxy/api/catalog/10/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toMatchObject({ error: 'mission_not_ready' });
  // The welcome signals buy ten pulls: they find several types, palettes and finishes.
  expect((await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' }, { cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
  const v = (await get(ctx.app, '/galaxy/api/catalog', { cookie })).json() as CatalogView;
  expect(v.found).toBeGreaterThanOrEqual(3);
  expect(v.entries.filter((e) => e.found)).toHaveLength(v.found);
  if (v.percent >= 10) {
    const claim = await post(ctx.app, '/galaxy/api/catalog/10/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(claim.statusCode).toBe(200);
    expect((claim.json() as CatalogView).rewards.find((r) => r.percent === 10)!.claimed).toBe(true);
    expect((await post(ctx.app, '/galaxy/api/catalog/10/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toMatchObject({ error: 'already_claimed' });
  }
});
