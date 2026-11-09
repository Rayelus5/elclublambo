import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type AutoFusionPreview, type AutoFusionResult, type CollectionPage, type GalaxyDetail, generateGalaxy } from '@galaxy/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { inTransaction } from '../../src/db/tx';
import { credit } from '../../src/economy/wallet';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Multiplayer plan, phase 2: the lock on a galaxy and the automatic fusion (preview, chain, protections, dust,
// idempotency, the ledger).
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('afu'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}

let seedCounter = 1n;
async function own(owner: string, tier: number, n = 1, over: { finish?: string; level?: number; level_dust?: number } = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = generateGalaxy(BigInt(Date.now()) * 1000n + 50_000n + seedCounter++, tier);
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
        finish: over.finish ?? 'normal',
        level: over.level ?? 1,
        level_dust: over.level_dust ?? 0,
        origin: 'grant',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(row.id);
  }
  return ids;
}

const dust = (id: string, n: number) => inTransaction(ctx.db, (trx) => credit(trx, id, 'dust', n, 'prueba'));
const auto = (cookie: string, criteria: object, preview = false, key = randomUUID()) =>
  post(ctx.app, '/galaxy/api/galaxies/fuse-auto', { criteria, preview }, { cookie, headers: preview ? {} : { 'idempotency-key': key } });
const counts = async (cookie: string) => ((await get(ctx.app, '/galaxy/api/galaxies?limit=60', { cookie })).json() as CollectionPage).counts;

test('el candado se pone y se quita, y la colección lo enseña y lo filtra', async () => {
  const { cookie, id } = await player();
  const [a, b] = await own(id, 0, 2);
  const res = await put(ctx.app, `/galaxy/api/galaxies/${a}/lock`, { locked: true }, { cookie });
  expect(res.statusCode).toBe(200);
  expect((res.json() as GalaxyDetail).locked).toBe(true);
  const only = (await get(ctx.app, '/galaxy/api/galaxies?locked=true', { cookie })).json() as CollectionPage;
  expect(only.items.map((g) => g.id)).toEqual([a]);
  const off = (await put(ctx.app, `/galaxy/api/galaxies/${a}/lock`, { locked: false }, { cookie })).json() as GalaxyDetail;
  expect(off.locked).toBeUndefined();
  // Someone else's galaxy: 404.
  const other = await player();
  expect((await put(ctx.app, `/galaxy/api/galaxies/${b}/lock`, { locked: true }, { cookie: other.cookie })).statusCode).toBe(404);
});

test('una galaxia con candado no se desintegra ni se fusiona a mano', async () => {
  const { cookie, id } = await player();
  const ids = await own(id, 0, 5);
  await dust(id, 100);
  await put(ctx.app, `/galaxy/api/galaxies/${ids[0]}/lock`, { locked: true }, { cookie });
  const d = await post(ctx.app, `/galaxy/api/galaxies/${ids[0]}/disintegrate`, undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(d.statusCode).toBe(409);
  expect(d.json()).toMatchObject({ error: 'galaxy_locked' });
  const f = await post(ctx.app, '/galaxy/api/galaxies/fuse', { ids }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(f.statusCode).toBe(409);
  expect(f.json()).toMatchObject({ error: 'galaxy_locked' });
  expect((await counts(cookie)).common).toBe(5);
});

test('la vista previa no cambia nada y dice lo que haría', async () => {
  const { cookie, id } = await player();
  await own(id, 0, 12);
  await own(id, 0, 1, { finish: 'holo' });
  await dust(id, 1000);
  const res = await auto(cookie, { from: 'common', upTo: 'rare' }, true);
  expect(res.statusCode).toBe(200);
  const p = res.json() as AutoFusionPreview;
  expect(p.steps).toEqual([{ from: 'common', to: 'uncommon', fusions: 2, dust: 40 }]);
  expect(p.kept.finishes).toBe(1);
  expect((await counts(cookie)).common).toBe(13);
});

test('fusiona en cadena, cobra el polvo, protege lo que se guarda y lo apunta en el libro', async () => {
  const { cookie, id } = await player();
  await own(id, 0, 25);
  const [holo] = await own(id, 0, 1, { finish: 'holo' });
  const [leveled] = await own(id, 0, 1, { level: 3, level_dust: 40 });
  const [locked] = await own(id, 0, 1);
  await put(ctx.app, `/galaxy/api/galaxies/${locked}/lock`, { locked: true }, { cookie });
  await dust(id, 1000);
  const key = randomUUID();
  const res = await auto(cookie, { from: 'common', upTo: 'rare' }, false, key);
  expect(res.statusCode).toBe(200);
  const r = res.json() as AutoFusionResult;
  // 25 → 5 poco comunes; si los acabados que salen no lo impiden, 5 → 1 rara.
  expect(r.fusions).toBeGreaterThanOrEqual(5);
  expect(r.dust).toBe(5 * 20 + (r.fusions - 5) * 50);
  expect(r.wallet.dust).toBe(1000 - r.dust);
  expect(r.galaxies.length).toBeGreaterThan(0);
  const c = await counts(cookie);
  expect(c.common).toBe(3);
  // The three it kept are still there.
  for (const g of [holo, leveled, locked]) expect((await get(ctx.app, `/galaxy/api/galaxies/${g}`, { cookie })).statusCode).toBe(200);
  const ledger = await sql<{ n: number }>`select count(*)::int as n from galaxy.ledger where account_id = ${id} and reason = 'fusion' and ref->>'auto' = ${key}`.execute(ctx.db);
  expect(ledger.rows[0]!.n).toBe(r.fusions);
  // The same key again: the same answer, nothing more fused.
  const again = (await auto(cookie, { from: 'common', upTo: 'rare' }, false, key)).json() as AutoFusionResult;
  expect(again.fusions).toBe(r.fusions);
  expect((await counts(cookie)).common).toBe(3);
});

test('sin polvo suficiente fusiona lo que alcanza y no deja el saldo en negativo', async () => {
  const { cookie, id } = await player();
  await own(id, 0, 20);
  await dust(id, 45);
  const r = (await auto(cookie, { from: 'common', upTo: 'uncommon' })).json() as AutoFusionResult;
  expect(r.fusions).toBe(2);
  expect(r.wallet.dust).toBe(5);
  expect((await counts(cookie)).common).toBe(10);
});

test('una petición rota → 400, y el rango que no sube → 400', async () => {
  const { cookie } = await player();
  expect((await auto(cookie, { from: 'rare', upTo: 'uncommon' })).statusCode).toBe(400);
  expect((await auto(cookie, { from: 'common' })).statusCode).toBe(400);
  expect((await post(ctx.app, '/galaxy/api/galaxies/fuse-auto', { criteria: { from: 'common', upTo: 'rare' }, extra: 1 }, { cookie })).statusCode).toBe(400);
});
