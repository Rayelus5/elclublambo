import { randomUUID } from 'node:crypto';
import { type OnboardingView, PROBE_TEST } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The first steps (GDD §12.2; M7c): they tick themselves from what the account has done.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({});
});
afterAll(() => ctx.close());

test('los primeros pasos se marcan solos: test de la sonda y tiradas de bienvenida', async () => {
  expect((await get(ctx.app, '/galaxy/api/onboarding')).statusCode).toBe(401);
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('onb'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const none = (await get(ctx.app, '/galaxy/api/onboarding', { cookie })).json() as OnboardingView;
  expect(none).toEqual({ probeTest: false, firstRun: false, welcomePulls: false, repairRoom: false, equipRelic: false });
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  expect((await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' }, { cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
  const some = (await get(ctx.app, '/galaxy/api/onboarding', { cookie })).json() as OnboardingView;
  expect(some).toMatchObject({ probeTest: true, welcomePulls: true, firstRun: false, repairRoom: false });
});
