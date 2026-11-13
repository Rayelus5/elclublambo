import { type AdminStorage, generateGalaxy, PROBE_TEST, type Role } from '@galaxy/shared';
import { ENGINE_VERSION } from '@galaxy/engine';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// «Almacenamiento» (the owner: «desde admin deberíamos de poder visualizar el almacenamiento del servidor»), for admins
// only: the database, the game's schema, the server's disk, the galaxies alive and disintegrated, and the biggest
// tables. The local database is shared with every other test, so the galaxies are checked by what a test adds.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
let admin: string;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}), disk: async () => ({ totalBytes: 80, freeBytes: 50 }) });
  admin = await staff('admin');
});
afterAll(() => ctx.close());

async function staff(role: Role): Promise<string> {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  return sessionCookie(res);
}

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('alm'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id };
}

const storage = async () => (await get(ctx.app, '/galaxy/api/admin/storage', { cookie: admin })).json() as AdminStorage;

test('un jugador o un moderador no ven el almacenamiento', async () => {
  const p = await player();
  const mod = await staff('moderator');
  for (const cookie of [p.cookie, mod]) expect((await get(ctx.app, '/galaxy/api/admin/storage', { cookie })).statusCode).toBe(403);
});

test('la base de datos, la parte del juego, el disco y las tablas más grandes primero', async () => {
  const s = await storage();
  expect(s.database.bytes).toBeGreaterThan(0);
  expect(s.database.gameBytes).toBeGreaterThan(0);
  expect(s.database.gameBytes).toBeLessThanOrEqual(s.database.bytes);
  expect(s.disk).toEqual({ totalBytes: 80, freeBytes: 50 });
  expect(s.tables.length).toBeGreaterThan(0);
  expect(s.tables.length).toBeLessThanOrEqual(12);
  expect(s.tables.map((x) => x.bytes)).toEqual([...s.tables.map((x) => x.bytes)].sort((a, b) => b - a));
  for (const x of s.tables) expect(x.indexBytes).toBeLessThanOrEqual(x.bytes);
});

test('cuenta las galaxias vivas y las desintegradas', async () => {
  const p = await player();
  const before = await storage();
  const make = async (disintegrated: boolean) => {
    const g = generateGalaxy(BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000)), 0);
    await ctx.db
      .insertInto('galaxy.galaxies')
      .values({ owner_id: p.id, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier: 0, score: g.score, finish: 'normal', origin: 'grant', disintegrated_at: disintegrated ? new Date() : null })
      .execute();
  };
  await make(false);
  await make(false);
  await make(true);
  const after = await storage();
  expect(after.galaxies.live - before.galaxies.live).toBe(2);
  expect(after.galaxies.disintegrated - before.galaxies.disintegrated).toBe(1);
  expect(after.galaxies.bytes).toBeGreaterThan(0);
});
