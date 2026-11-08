import { randomUUID } from 'node:crypto';
import { PROBE_TEST, type RedshiftView, type RunStart } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The prestige «Corrimiento al rojo» (GDD §12.5; M7e-2): from its level and with enough Laboratorio levels, a rank
// restarts the Laboratorio (nodes and room) for a small bonus each run and a title; the collection stays; it asks
// again for Laboratorio levels before the next rank, and stops at the last one.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ redshift: { minLevel: 5, maxRank: 2, labLevels: [3, 4] } }) });
});
afterAll(() => ctx.close());

test('un rango reinicia el Laboratorio, da su bonus y su título, no toca la colección y pide volver a invertir', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('rsh'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  const take = () => post(ctx.app, '/galaxy/api/redshift', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
  const view = async () => (await get(ctx.app, '/galaxy/api/redshift', { cookie })).json() as RedshiftView;

  expect(await view()).toMatchObject({ rank: 0, level: 1, labLevels: 0, needed: 3, eligible: false });
  expect((await take()).json()).toEqual({ error: 'redshift_not_ready' });

  // Level 5 and three Laboratorio levels, with the room repaired and a galaxy in the collection.
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: 1000 }).execute();
  await ctx.db.insertInto('galaxy.station_rooms').values({ account_id: id, room: 'lab', level: 1, updated_at: new Date() }).onConflict((oc) => oc.columns(['account_id', 'room']).doUpdateSet({ level: 1 })).execute();
  await ctx.db.insertInto('galaxy.lab_nodes').values([{ account_id: id, node: 'probe-hp', level: 3, updated_at: new Date() }]).execute();
  await get(ctx.app, '/galaxy/api/gacha', { cookie });
  await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  const galaxies = async () => (await ctx.db.selectFrom('galaxy.galaxies').select((eb) => eb.fn.countAll<string>().as('n')).where('owner_id', '=', id).executeTakeFirstOrThrow()).n;
  const before = await galaxies();
  expect(await view()).toMatchObject({ eligible: true, next: { title: 'Corrimiento I' } });

  const after = (await take()).json() as RedshiftView;
  expect(after).toMatchObject({ rank: 1, labLevels: 0, needed: 4, eligible: false, bonus: { xp: 0.03, luck: 0.02 } });
  expect(await ctx.db.selectFrom('galaxy.lab_nodes').select('node').where('account_id', '=', id).execute()).toEqual([]);
  expect((await ctx.db.selectFrom('galaxy.station_rooms').select('level').where('account_id', '=', id).where('room', '=', 'lab').executeTakeFirstOrThrow()).level).toBe(0);
  expect(await galaxies()).toBe(before);
  expect(await ctx.db.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', id).where('kind', '=', 'title').execute()).toContainEqual({ value: 'Corrimiento I' });
  expect((await take()).json()).toEqual({ error: 'redshift_not_ready' });

  // The next run carries the rank's bonus.
  const run = (await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json() as RunStart;
  expect(run.bonuses).toEqual(expect.arrayContaining([{ stat: 'xp', value: 0.03 }, { stat: 'luck', value: 0.02 }]));
});
