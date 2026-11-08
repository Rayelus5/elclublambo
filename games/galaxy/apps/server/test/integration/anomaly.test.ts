import { randomUUID } from 'node:crypto';
import { type BoostsView, PROBE_TEST, type RunStart } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The season's anomaly (GDD §13.1; M7d-3): while the season is open, every run starts with it (snapshotted with the
// run, so the replay plays it too) and the hub shows it; out of season, none.
const now = Date.now();
const overrides: Record<string, unknown> = {
  season: { id: 'anomalia-test', name: 'Prueba', startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), anomaly: 'swarm' },
};
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig(overrides) });
});
afterAll(() => ctx.close());

test('una incursión de la temporada empieza con su anomalía y el inicio la enseña; fuera de temporada, ninguna', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('anm'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  const start = async () => (await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json() as RunStart;

  const run = await start();
  expect(run.anomaly).toBe('swarm');
  const kept = await ctx.db.selectFrom('galaxy.runs').select('upgrades').where('id', '=', run.id).executeTakeFirstOrThrow();
  expect((kept.upgrades as { anomaly: string }).anomaly).toBe('swarm');
  expect(((await get(ctx.app, '/galaxy/api/boosts', { cookie })).json() as BoostsView).anomaly).toMatchObject({ id: 'swarm', name: 'Enjambre' });

  overrides.season = { ...(overrides.season as object), startsAt: new Date(now - 7_200_000).toISOString(), endsAt: new Date(now - 3_600_000).toISOString() };
  expect((await start()).anomaly).toBeNull();
  expect(((await get(ctx.app, '/galaxy/api/boosts', { cookie })).json() as BoostsView).anomaly).toBeNull();
});

test('las galaxias de una tirada en la temporada llevan su sello de origen (M8c)', async () => {
  overrides.season = { id: 'sello-test', name: 'Prueba', startsAt: new Date(now - 3_600_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString() };
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('sel'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await get(ctx.app, '/galaxy/api/gacha', { cookie });
  expect((await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' }, { cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
  const seals = await ctx.db.selectFrom('galaxy.galaxies').select('season').where('owner_id', '=', id).where('origin', '=', 'pull').execute();
  expect(seals.length).toBe(10);
  expect(new Set(seals.map((s) => s.season))).toEqual(new Set(['sello-test']));
});
