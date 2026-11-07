import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type CollectionPage, generateGalaxy, PROBE_TEST, type PlanetariumView, type PlanetariumVisit, type RunStart } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The planetarium on the server (GDD §10.5, §14.2; M4c-2): a player exhibits up to six of their galaxies, which adds
// prestige and a small experience bonus that a run snapshots at its start; an exhibited galaxy is neither fused nor
// disintegrated; anyone signed in visits a planetarium by name and sees only what it exhibits; visits count once per
// visitor and day, never one's own; the featured list shows other planetariums with something on display.

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('pla');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id, username };
}

let seedCounter = 1n;
async function own(owner: string, tier: number, n = 1, finish = 'normal'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = generateGalaxy(BigInt(Date.now()) * 1000n + 919n + seedCounter++, tier);
    const row = await ctx.db
      .insertInto('galaxy.galaxies')
      .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier, score: g.score, finish, origin: 'grant' })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  return ids;
}
const exhibit = (cookie: string, galaxies: (string | null)[]) => put(ctx.app, '/galaxy/api/planetarium/exhibits', { galaxies }, { cookie });
const view = async (cookie: string) => (await get(ctx.app, '/galaxy/api/planetarium', { cookie })).json() as PlanetariumView;
const visit = (cookie: string, username: string) => get(ctx.app, `/galaxy/api/planetarium/visit/${username}`, { cookie });
const act = (cookie: string, url: string, body?: object) => post(ctx.app, url, body, { cookie, headers: { 'idempotency-key': randomUUID() } });
const startRun = (cookie: string) =>
  post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });

test('exponer tres galaxias: cada una en su pedestal, con su prestigio y su bonus', async () => {
  const a = await player();
  const [legend] = await own(a.id, 4, 1, 'holo');
  const [rare] = await own(a.id, 2);
  const [common] = await own(a.id, 0);
  const res = await exhibit(a.cookie, [legend!, null, rare!, common!]);
  expect(res.statusCode).toBe(200);
  const v = res.json() as PlanetariumView;
  expect(v.slots).toBe(6);
  expect(v.exhibits.map((g) => g?.id ?? null)).toEqual([legend, null, rare, common, null, null]);
  expect(v.exhibits[0]).toMatchObject({ tier: 'legendary', finish: 'holo', exhibited: true });
  // 12 + 1 (holo) + 4 + 1.
  expect(v.prestige).toBe(18);
  expect(v.bonus).toBe(0.018);
  expect(v.visits).toBe(0);
  expect(await view(a.cookie)).toEqual(v);

  // The collection marks them.
  const page = (await get(ctx.app, '/galaxy/api/galaxies?sort=rarity', { cookie: a.cookie })).json() as CollectionPage;
  expect(page.items.find((g) => g.id === rare)).toMatchObject({ exhibited: true });

  // Taking one down leaves the rest where they were.
  const after = (await exhibit(a.cookie, [legend!, null, null, common!])).json() as PlanetariumView;
  expect(after.exhibits.map((g) => g?.id ?? null)).toEqual([legend, null, null, common, null, null]);
  expect(after.prestige).toBe(14);
  const again = (await get(ctx.app, '/galaxy/api/galaxies?sort=rarity', { cookie: a.cookie })).json() as CollectionPage;
  expect(again.items.find((g) => g.id === rare)?.exhibited).toBeUndefined();
});

test('duplicados, galaxias ajenas o desintegradas y más pedestales de los que hay no cambian nada', async () => {
  const a = await player();
  const b = await player();
  const [mine, gone] = await own(a.id, 1, 2);
  const [theirs] = await own(b.id, 1);
  expect((await exhibit(a.cookie, [mine!])).statusCode).toBe(200);
  expect((await act(a.cookie, `/galaxy/api/galaxies/${gone}/disintegrate`)).statusCode).toBe(200);
  const before = await view(a.cookie);

  const dup = await exhibit(a.cookie, [mine!, mine!]);
  expect(dup.statusCode).toBe(400);
  const foreign = await exhibit(a.cookie, [mine!, theirs!]);
  expect(foreign.statusCode).toBe(404);
  expect(foreign.json()).toEqual({ error: 'galaxy_not_found' });
  expect((await exhibit(a.cookie, [gone!])).statusCode).toBe(404);
  expect((await exhibit(a.cookie, [mine!, null, null, null, null, null, null])).statusCode).toBe(400);
  expect((await exhibit(a.cookie, Array.from({ length: 9 }, () => null))).statusCode).toBe(400);
  expect(await view(a.cookie)).toEqual(before);
});

test('una galaxia expuesta no se desintegra ni se fusiona, y no se cobra nada', async () => {
  const a = await player();
  const five = await own(a.id, 0, 5);
  await credit(ctx.db, a.id, 'dust', 500, 'test');
  expect((await exhibit(a.cookie, [five[2]!])).statusCode).toBe(200);
  const wallet = await getWallet(ctx.db, a.id);

  const dis = await act(a.cookie, `/galaxy/api/galaxies/${five[2]}/disintegrate`);
  expect(dis.statusCode).toBe(409);
  expect(dis.json()).toEqual({ error: 'galaxy_exhibited' });
  const fused = await act(a.cookie, '/galaxy/api/galaxies/fuse', { ids: five });
  expect(fused.statusCode).toBe(409);
  expect(fused.json()).toEqual({ error: 'galaxy_exhibited' });
  expect(await getWallet(ctx.db, a.id)).toEqual(wallet);
  const alive = await ctx.db.selectFrom('galaxy.galaxies').select('id').where('id', 'in', five).where('disintegrated_at', 'is', null).execute();
  expect(alive).toHaveLength(5);

  // Taken down, it goes.
  expect((await exhibit(a.cookie, [null])).statusCode).toBe(200);
  expect((await act(a.cookie, `/galaxy/api/galaxies/${five[2]}/disintegrate`)).statusCode).toBe(200);
});

test('visitar un planetario enseña solo lo expuesto y cuenta una visita por visitante y día', async () => {
  const a = await player();
  const b = await player();
  const [shown] = await own(a.id, 3, 1, 'prismatic');
  await own(a.id, 4, 2);
  await exhibit(a.cookie, [null, shown!]);

  const res = await visit(b.cookie, a.username.toUpperCase());
  expect(res.statusCode).toBe(200);
  const v = res.json() as PlanetariumVisit;
  expect(Object.keys(v).sort()).toEqual(['exhibits', 'owner', 'prestige', 'visits']);
  expect(v.owner).toBe(a.username);
  expect(v.prestige).toBe(8);
  expect(v.visits).toBe(1);
  expect(v.exhibits).toHaveLength(6);
  expect(v.exhibits[0]).toBeNull();
  expect(Object.keys(v.exhibits[1]!).sort()).toEqual(['designation', 'featured', 'finish', 'id', 'level', 'name', 'seed', 'tier', 'traits']);
  expect(v.exhibits.filter(Boolean)).toHaveLength(1);

  // The same visitor the same day, and the owner, do not count again.
  expect(((await visit(b.cookie, a.username)).json() as PlanetariumVisit).visits).toBe(1);
  expect(((await visit(a.cookie, a.username)).json() as PlanetariumVisit).visits).toBe(1);
  expect((await view(a.cookie)).visits).toBe(1);

  const missing = await visit(b.cookie, 'nadie_por_aqui_zz');
  expect(missing.statusCode).toBe(404);
  expect(missing.json()).toEqual({ error: 'planetarium_not_found' });
  expect((await visit(b.cookie, 'a')).statusCode).toBe(400);
  expect((await get(ctx.app, `/galaxy/api/planetarium/visit/${a.username}`)).statusCode).toBe(401);
});

test('un planetario vacío se visita y dice que no tiene nada', async () => {
  const a = await player();
  const b = await player();
  const v = (await visit(b.cookie, a.username)).json() as PlanetariumVisit;
  expect(v.exhibits).toEqual([null, null, null, null, null, null]);
  expect(v.prestige).toBe(0);
});

test('los destacados: otros planetarios con algo expuesto, por prestigio, sin el propio', async () => {
  const top = await player();
  await exhibit(top.cookie, await own(top.id, 4, 6, 'holo'));
  const empty = await player();
  const me = await player();
  await exhibit(me.cookie, await own(me.id, 4, 6, 'holo'));

  const { featured } = await view(me.cookie);
  expect(featured.length).toBeGreaterThan(0);
  expect(featured.length).toBeLessThanOrEqual(8);
  const owners = featured.map((f) => f.owner);
  expect(owners).not.toContain(me.username);
  expect(owners).not.toContain(empty.username);
  // The top prestige (six holo legendaries), the newest first among equals.
  expect(featured[0]).toMatchObject({ owner: top.username, prestige: 78, exhibits: 6 });
  expect(featured[0]!.cover).toMatchObject({ tier: 'legendary', finish: 'holo' });
  expect(Object.keys(featured[0]!.cover!).sort()).toEqual(['designation', 'featured', 'finish', 'id', 'level', 'name', 'seed', 'tier', 'traits']);
  for (let i = 1; i < featured.length; i++) expect(featured[i]!.prestige).toBeLessThanOrEqual(featured[i - 1]!.prestige);
  for (const f of featured) expect(f.exhibits).toBeGreaterThan(0);
});

test('una incursión empieza con el bonus del planetario y cambiar lo expuesto después no la toca', async () => {
  const a = await player();
  await exhibit(a.cookie, await own(a.id, 4, 6, 'holo'));
  const res = await startRun(a.cookie);
  expect(res.statusCode).toBe(200);
  const run = res.json() as RunStart;
  expect(run.bonuses).toContainEqual({ stat: 'xp', value: 0.05 });
  await exhibit(a.cookie, [null]);
  const row = await ctx.db.selectFrom('galaxy.runs').select('upgrades').where('id', '=', run.id).executeTakeFirstOrThrow();
  expect((row.upgrades as { bonuses: unknown[] }).bonuses).toContainEqual({ stat: 'xp', value: 0.05 });

  // Nothing on display, no bonus.
  const b = await player();
  const plain = (await startRun(b.cookie)).json() as RunStart;
  expect(plain.bonuses.some((x) => x.stat === 'xp')).toBe(false);
});
