import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { generateGalaxy, type CollectionPage, type GalaxyDetail, type GalaxySummary } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { inTransaction } from '../../src/db/tx';
import { credit, getWallet } from '../../src/economy/wallet';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// GDD §8.5: the collection (paged, filtered), disintegration into dust and fusion of five into a higher tier.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('col'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}

let seedCounter = 1n;
/** Owned galaxies straight into the table (faster than pulling): real engine galaxies of the given tier. */
async function own(owner: string, tier: number, n = 1, finish = 'normal'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = generateGalaxy(BigInt(Date.now()) * 1000n + seedCounter++, tier);
    const row = await ctx.db
      .insertInto('galaxy.galaxies')
      .values({
        owner_id: owner,
        seed: g.seed.toString(),
        engine_version: ENGINE_VERSION,
        traits: JSON.stringify(g.traits),
        dna: g.dna,
        name: g.name,
        designation: g.designation,
        tier,
        score: g.score,
        finish,
        origin: 'grant',
        created_at: new Date(Date.now() - (n - i) * 1000),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  return ids;
}

const list = async (cookie: string, query = '') =>
  (await get(ctx.app, `/galaxy/api/galaxies${query}`, { cookie })).json() as CollectionPage;
const act = (cookie: string, url: string, body?: object, key = randomUUID()) =>
  post(ctx.app, url, body, { cookie, headers: { 'idempotency-key': key } });

test('la colección pagina sin repetir ni saltar, por fecha y por rareza (Review Focus 5)', async () => {
  const { cookie, id } = await player();
  await own(id, 0, 100);
  await own(id, 2, 25);
  await own(id, 4, 5);
  for (const sort of ['new', 'rarity']) {
    const seen: GalaxySummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await list(cookie, `?sort=${sort}&limit=60${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...page.items);
      cursor = page.next;
      expect(page.counts).toEqual({ common: 100, uncommon: 0, rare: 25, epic: 0, legendary: 5 });
    } while (cursor);
    expect(seen, sort).toHaveLength(130);
    expect(new Set(seen.map((g) => g.id)).size).toBe(130);
    if (sort === 'rarity') {
      const tiers = seen.map((g) => ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(g.tier));
      expect(tiers).toEqual([...tiers].sort((a, b) => b - a));
    } else {
      const times = seen.map((g) => Date.parse(g.createdAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    }
  }
});

test('filtra por nivel, tipo, paleta y acabado, y solo enseña las propias', async () => {
  const me = await player();
  const other = await player();
  await own(me.id, 4, 3);
  await own(me.id, 0, 4, 'holo');
  const theirs = await own(other.id, 4, 1);
  const legendary = await list(me.cookie, '?tier=legendary');
  expect(legendary.items).toHaveLength(3);
  expect(legendary.items.every((g) => g.tier === 'legendary')).toBe(true);
  expect((await list(me.cookie, '?finish=holo')).items).toHaveLength(4);
  const type = legendary.items[0]!.traits['galaxy_type']!;
  expect((await list(me.cookie, `?type=${type}`)).items.every((g) => g.traits['galaxy_type'] === type)).toBe(true);
  const palette = legendary.items[0]!.traits['palette']!;
  expect((await list(me.cookie, `?palette=${palette}`)).items.every((g) => g.traits['palette'] === palette)).toBe(true);
  expect((await get(ctx.app, `/galaxy/api/galaxies/${theirs[0]}`, { cookie: me.cookie })).statusCode).toBe(404);
  const mine = (await get(ctx.app, `/galaxy/api/galaxies/${legendary.items[0]!.id}`, { cookie: me.cookie })).json() as GalaxyDetail;
  expect(mine).toMatchObject({ origin: 'grant', lineage: [], level: 1 });
  expect(mine.dna).toMatch(/^[0-9a-f]{64}$/);
  expect((await get(ctx.app, '/galaxy/api/galaxies?tier=mythic', { cookie: me.cookie })).statusCode).toBe(400);
});

test('filtra por fenómeno: uno concreto, cualquiera o ninguno (plan «escáner pro», parte D)', async () => {
  const me = await player();
  await own(me.id, 4, 3);
  await own(me.id, 0, 6);
  const all = await list(me.cookie, '?limit=60');
  const withOne = all.items.filter((g) => g.traits['phenomenon'] !== 'none');
  const without = all.items.filter((g) => g.traits['phenomenon'] === 'none');
  // Legendaries always have one.
  expect(withOne.length).toBeGreaterThanOrEqual(3);
  const any = await list(me.cookie, '?phenomenon=any&limit=60');
  expect(any.items.map((g) => g.id).sort()).toEqual(withOne.map((g) => g.id).sort());
  const none = await list(me.cookie, '?phenomenon=none&limit=60');
  expect(none.items.map((g) => g.id).sort()).toEqual(without.map((g) => g.id).sort());
  const one = withOne[0]!.traits['phenomenon']!;
  const exact = await list(me.cookie, `?phenomenon=${one}&limit=60`);
  expect(exact.items.length).toBeGreaterThan(0);
  expect(exact.items.every((g) => g.traits['phenomenon'] === one)).toBe(true);
  expect((await get(ctx.app, '/galaxy/api/galaxies?phenomenon=Supernova!', { cookie: me.cookie })).statusCode).toBe(400);
});

test('desintegrar da el polvo una vez; la galaxia desaparece de la colección', async () => {
  const { cookie, id } = await player();
  const [galaxy] = await own(id, 2, 1, 'holo');
  const res = await act(cookie, `/galaxy/api/galaxies/${galaxy}/disintegrate`);
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ dust: 45, wallet: { dust: 45 } });
  const again = await act(cookie, `/galaxy/api/galaxies/${galaxy}/disintegrate`);
  expect(again.statusCode).toBe(404);
  expect(again.json()).toEqual({ error: 'galaxy_not_found' });
  expect((await getWallet(ctx.db, id)).dust).toBe(45);
  expect((await list(cookie)).items).toHaveLength(0);
});

test('fusionar cinco del mismo nivel da una del siguiente con su linaje y cuesta polvo', async () => {
  const { cookie, id } = await player();
  const ids = await own(id, 0, 5);
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'dust', 25, 'prueba'));
  const res = await act(cookie, '/galaxy/api/galaxies/fuse', { ids });
  expect(res.statusCode).toBe(200);
  const body = res.json() as { galaxy: GalaxySummary; wallet: { dust: number } };
  expect(body.galaxy.tier).toBe('uncommon');
  expect(body.wallet.dust).toBe(5);
  const detail = (await get(ctx.app, `/galaxy/api/galaxies/${body.galaxy.id}`, { cookie })).json() as GalaxyDetail;
  expect(detail.origin).toBe('fusion');
  // The parents are gone from the collection, but the lineage still names them.
  expect(detail.lineage.map((p) => p.id).sort()).toEqual([...ids].sort());
  expect(detail.lineage.every((p) => p.tier === 'common' && p.name.length > 0 && /^GX-/.test(p.designation))).toBe(true);
  const page = await list(cookie);
  expect(page.items.map((g) => g.id)).toEqual([body.galaxy.id]);
});

test('el detalle dice el polvo que daría y la colección trae la receta de fusión', async () => {
  const { cookie, id } = await player();
  const [epic] = await own(id, 3, 1, 'holo');
  const detail = (await get(ctx.app, `/galaxy/api/galaxies/${epic}`, { cookie })).json() as GalaxyDetail;
  expect(detail.dust).toBe(113); // 75 × 1,5 rounded, exactly what disintegrating it pays
  expect(detail.lineage).toEqual([]);
  expect((await list(cookie)).fusion).toEqual({ count: 5, dust: [20, 50, 120, 300] });
  const res = await act(cookie, `/galaxy/api/galaxies/${epic}/disintegrate`);
  expect((res.json() as { dust: number }).dust).toBe(detail.dust);
});

test('una fusión no válida no cambia nada (Review Focus 4)', async () => {
  const { cookie, id } = await player();
  const commons = await own(id, 0, 6);
  const [rare] = await own(id, 2, 1);
  const legendaries = await own(id, 4, 5);
  const other = await player();
  const [foreign] = await own(other.id, 0, 1);
  const [gone] = await own(id, 0, 1);
  await act(cookie, `/galaxy/api/galaxies/${gone}/disintegrate`);
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'dust', 1000, 'prueba'));
  const dustBefore = (await getWallet(ctx.db, id)).dust;
  const bad = [
    commons.slice(0, 4), // too few
    [...commons.slice(0, 4), rare], // mixed tiers
    legendaries, // legendaries do not fuse
    [...commons.slice(0, 4), foreign], // someone else's
    [...commons.slice(0, 4), gone], // already disintegrated
  ];
  for (const ids of bad) {
    const res = await act(cookie, '/galaxy/api/galaxies/fuse', { ids });
    expect(res.statusCode, JSON.stringify(ids)).toBe(409);
    expect(res.json()).toEqual({ error: 'invalid_fusion' });
  }
  expect((await act(cookie, '/galaxy/api/galaxies/fuse', { ids: [commons[0], ...commons.slice(0, 4)] })).statusCode).toBe(400);
  expect((await getWallet(ctx.db, id)).dust).toBe(dustBefore);
  expect((await list(cookie)).items).toHaveLength(12);
  const poor = await player();
  const five = await own(poor.id, 0, 5);
  const broke = await act(poor.cookie, '/galaxy/api/galaxies/fuse', { ids: five });
  expect(broke.statusCode).toBe(402);
  expect((await list(poor.cookie)).items).toHaveLength(5);
});

test('desintegrar y fusionar la misma galaxia a la vez: solo gana una operación (Review Focus 4)', async () => {
  const { cookie, id } = await player();
  const ids = await own(id, 0, 5);
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'dust', 20, 'prueba'));
  const [dis, fuse] = await Promise.all([
    act(cookie, `/galaxy/api/galaxies/${ids[0]}/disintegrate`),
    act(cookie, '/galaxy/api/galaxies/fuse', { ids }),
  ]);
  expect([dis.statusCode, fuse.statusCode].filter((s) => s === 200)).toHaveLength(1);
  const live = (await list(cookie)).items;
  if (dis.statusCode === 200) expect(live).toHaveLength(4);
  else expect(live).toHaveLength(1);
});

test('una galaxia equipada como reliquia no se desintegra ni se fusiona, y la colección lo dice', async () => {
  const { cookie, id } = await player();
  const [equipped, ...rest] = await own(id, 0, 5);
  const ok = await ctx.app.inject({
    method: 'PUT',
    url: '/galaxy/api/hangar/loadout',
    payload: { relics: [equipped] },
    headers: { cookie: `gs_sid=${cookie}`, origin: 'http://localhost:5173', 'cf-connecting-ip': '10.9.9.9' },
  });
  expect(ok.statusCode).toBe(200);
  const gone = await act(cookie, `/galaxy/api/galaxies/${equipped}/disintegrate`);
  expect(gone.statusCode).toBe(409);
  expect(gone.json()).toEqual({ error: 'galaxy_equipped' });
  await ctx.db.insertInto('galaxy.balances').values({ account_id: id, currency: 'dust', amount: 1000 }).onConflict((oc) => oc.columns(['account_id', 'currency']).doUpdateSet({ amount: 1000 })).execute();
  const fused = await act(cookie, '/galaxy/api/galaxies/fuse', { ids: [equipped!, ...rest.slice(0, 4)] });
  expect(fused.statusCode).toBe(409);
  expect(fused.json()).toEqual({ error: 'galaxy_equipped' });
  const page = await list(cookie);
  expect(page.items.find((g) => g.id === equipped)?.equipped).toBe(true);
  expect(page.items.find((g) => g.id === rest[0])?.equipped).toBe(false);
  expect(((await get(ctx.app, `/galaxy/api/galaxies/${equipped}`, { cookie })).json() as GalaxyDetail).equipped).toBe(true);
});

test('el laboratorio (M4b-2): Reciclaje da más polvo al desintegrar y Fusión estable cobra menos al fusionar', async () => {
  const { cookie, id } = await player();
  await ctx.db
    .insertInto('galaxy.lab_nodes')
    .values([
      { account_id: id, node: 'recycling', level: 5 },
      { account_id: id, node: 'stable-fusion', level: 1 },
    ])
    .execute();
  const [epic] = await own(id, 3, 1, 'holo');
  const detail = (await get(ctx.app, `/galaxy/api/galaxies/${epic}`, { cookie })).json() as GalaxyDetail;
  expect(detail.dust).toBe(135); // 113 × 1,2, rounded down
  expect((await list(cookie)).fusion).toEqual({ count: 5, dust: [20, 48, 116, 288] }); // × 0,96, rounded up
  const res = await act(cookie, `/galaxy/api/galaxies/${epic}/disintegrate`);
  expect((res.json() as { dust: number }).dust).toBe(135);
  const five = await own(id, 1, 5);
  const fused = await act(cookie, '/galaxy/api/galaxies/fuse', { ids: five });
  expect(fused.statusCode).toBe(200);
  expect((fused.json() as { wallet: { dust: number } }).wallet.dust).toBe(135 - 48);
});
