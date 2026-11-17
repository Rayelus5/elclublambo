import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type FindsView, generateGalaxy, LEGENDARY } from '@galaxy/shared';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { forgetFinds } from '../../src/gacha/finds';
import { galaxyValues } from '../../src/galaxies/insert';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The scanner's finds (2026-11-17, the owner: «Últimos hallazgos» and «Escaparate de premios»): the legendaries and
// mythics anyone found lately, by visible accounts only and never someone blocked either way; my best scans of the week;
// the showcase topped up with examples.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());
beforeEach(() => forgetFinds());

async function player() {
  const username = uniqueName('find');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id, username };
}
type P = Awaited<ReturnType<typeof player>>;

let n = 0;
/** A pull of this tier found by `p` (its galaxy and its audit row), `minutesAgo` ago; optionally an event's featured one. */
async function found(p: P, tier: number, minutesAgo = 1, featuredIn: string | null = null) {
  const g = generateGalaxy(BigInt(Date.now()) * 100n + BigInt(++n), tier);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values(galaxyValues(g, { owner: p.id, tier, finish: 'normal', origin: 'pull', featured: featuredIn !== null }))
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.db
    .insertInto('galaxy.gacha_pulls')
    .values({
      account_id: p.id,
      banner: featuredIn ?? 'deep-scan',
      pity_group: featuredIn ? `event-${featuredIn}` : 'standard',
      seed: '1',
      tier,
      featured: featuredIn !== null,
      finish: 'normal',
      pity_before: 0,
      config_version: 0,
      engine_version: ENGINE_VERSION,
      galaxy_id: row.id,
      operation_key: randomUUID(),
      created_at: new Date(Date.now() - minutesAgo * 60_000),
    })
    .execute();
  return row.id;
}
const finds = async (p: P) => (await get(ctx.app, '/galaxy/api/gacha/finds', { cookie: p.cookie })).json() as FindsView;

test('las legendarias recientes de otros salen con quién y cuándo; las mías de la semana, en «Tus mejores»', async () => {
  const [a, me] = [await player(), await player()];
  const legend = await found(a, LEGENDARY);
  const epic = await found(me, 3);
  await found(me, 1);
  const v = await finds(me);
  const mine = v.recent.find((f) => f.galaxy.id === legend)!;
  expect(mine).toMatchObject({ by: a.username, banner: 'deep-scan', galaxy: { tier: 'legendary' } });
  expect(new Date(mine.at).getTime()).toBeGreaterThan(Date.now() - 5 * 60_000);
  expect(v.mine.map((g) => g.id)).toEqual([epic]);
  // The showcase: the latest distinct finds first (other tests may add newer ones meanwhile, so no particular one is
  // asserted), then examples up to six; mythics only while they can come out (none by default).
  const real = v.showcase.filter((g) => !g.example).map((g) => g.id);
  const latest = [...new Set(v.recent.filter((f) => f.galaxy.tier !== 'mythic').map((f) => f.galaxy.id))];
  expect(real).toEqual(latest.slice(0, real.length));
  expect(v.showcase.length).toBeGreaterThanOrEqual(6);
  expect(v.showcase.filter((g) => g.example).every((g) => g.tier === 'legendary')).toBe(true);
});

test('nunca sale quien bloqueé, ni quien me bloqueó, ni una cuenta baneada o borrada', async () => {
  const [me, blocked, blocker, banned, gone] = [await player(), await player(), await player(), await player(), await player()];
  const ids = { blocked: await found(blocked, LEGENDARY), blocker: await found(blocker, LEGENDARY), banned: await found(banned, LEGENDARY), gone: await found(gone, LEGENDARY) };
  await post(ctx.app, `/galaxy/api/friends/${blocked.username}/block`, undefined, { cookie: me.cookie });
  await post(ctx.app, `/galaxy/api/friends/${me.username}/block`, undefined, { cookie: blocker.cookie });
  await ctx.db.updateTable('galaxy.accounts').set({ banned_until: new Date(Date.now() + 86_400_000) }).where('id', '=', banned.id).execute();
  await ctx.db.updateTable('galaxy.accounts').set({ deleted_at: new Date() }).where('id', '=', gone.id).execute();
  forgetFinds();
  const shown = new Set((await finds(me)).recent.map((f) => f.galaxy.id));
  for (const id of Object.values(ids)) expect(shown.has(id)).toBe(false);
  // Another viewer still sees the ones only I blocked.
  const other = new Set((await finds(await player())).recent.map((f) => f.galaxy.id));
  expect(other.has(ids.blocked)).toBe(true);
  expect(other.has(ids.banned)).toBe(false);
});

test('lo de hace más de 14 días ya no sale', async () => {
  const [a, me] = [await player(), await player()];
  const old = await found(a, LEGENDARY, 15 * 24 * 60);
  expect((await finds(me)).recent.some((f) => f.galaxy.id === old)).toBe(false);
});

test('quien ocultó su estado no sale en los hallazgos: un hallazgo dice cuándo jugó (revisión)', async () => {
  const [shy, me] = [await player(), await player()];
  const id = await found(shy, LEGENDARY);
  await ctx.db.insertInto('galaxy.social_prefs').values({ account_id: shy.id, invites: 'friends', show_status: false, updated_at: new Date() }).execute();
  forgetFinds();
  expect((await finds(me)).recent.some((f) => f.galaxy.id === id)).toBe(false);
});

test('la destacada de un escáner de evento es su último hallazgo, aunque haya muchos más recientes (revisión)', async () => {
  const banners = [
    { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' },
    { id: 'nova-finds', kind: 'event', name: 'Semana Nova', pityGroup: 'event-nova-finds', currency: 'signal:nova-finds', featured: { trait: 'phenomenon', value: 'supernova' } },
  ];
  const app = await testApp({ configOverrides: { gacha: { banners } } });
  try {
    const reg = async () => {
      const res = await post(app.app, '/galaxy/api/auth/register', { username: uniqueName('fev'), password: 'una-clave-larga' });
      return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id, username: '' };
    };
    const [a, me] = [await reg(), await reg()];
    const star = await found(a, LEGENDARY, 30, 'nova-finds');
    // 45 newer legendaries elsewhere push it out of the 40 recent ones.
    for (let i = 0; i < 45; i++) await found(a, LEGENDARY, 1);
    forgetFinds();
    const v = (await get(app.app, '/galaxy/api/gacha/finds', { cookie: me.cookie })).json() as FindsView;
    expect(v.recent.some((f) => f.galaxy.id === star)).toBe(false);
    expect(v.featured['nova-finds']).toMatchObject({ id: star, featured: true });
    expect(v.featured['nova-finds']!.example).toBeUndefined();
  } finally {
    await app.close();
  }
});
