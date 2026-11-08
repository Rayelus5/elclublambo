import { randomUUID } from 'node:crypto';
import type { PullResponse } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { type ConfigService, createConfigService } from '../../src/config/service';
import { inTransaction } from '../../src/db/tx';
import { credit } from '../../src/economy/wallet';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Final review (M2b): an economy operation holds one pooled connection for its whole transaction. Anything it reads
// through the pool meanwhile (the live config when its cache expires) needs a SECOND connection: under load the pool
// runs dry and every operation stalls. With a one-connection pool and a cache that always expires, that is a timeout.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ pool: { max: 1, timeoutMs: 1500 }, configTtlMs: 0 });
});
afterAll(() => ctx.close());

const act = (cookie: string, url: string, body?: object) => post(ctx.app, url, body, { cookie, headers: { 'idempotency-key': randomUUID() } });

test('escanear, desintegrar y fusionar no piden una segunda conexión al pool dentro de su transacción', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('pool'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  expect((await get(ctx.app, '/galaxy/api/gacha', { cookie })).statusCode).toBe(200);
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'dust', 500, 'prueba'));

  const pulled = await act(cookie, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' });
  expect(pulled.statusCode).toBe(200);
  const galaxies = (pulled.json() as PullResponse).pulls;

  const gone = await act(cookie, `/galaxy/api/galaxies/${galaxies[0]!.id}/disintegrate`);
  expect(gone.statusCode).toBe(200);

  // A fusion that is not valid still reads the recipe inside the operation: it must answer 409, not time out.
  const fused = await act(cookie, '/galaxy/api/galaxies/fuse', { ids: galaxies.slice(1, 6).map((g) => g.id) });
  expect([200, 409]).toContain(fused.statusCode);
});

test('cada tirada guarda la versión de configuración con la que se sorteó', async () => {
  // The config this process drew with is what each pull records, never what the database says when it records it.
  // Without publishing anything (the local database is the user's): this process's service hands out a version the
  // database has never had, so reading the version back from the database would record a different one.
  const real = createConfigService(ctx.db, { ttlMs: 60_000 });
  const live = await real.getVersioned('gacha');
  const drawn = live.version + 1000;
  const mine: ConfigService = {
    ...real,
    getVersioned: async (key) => {
      const v = await real.getVersioned(key);
      return key === 'gacha' ? { ...v, version: drawn } : v;
    },
  };
  const app = await testApp({ config: mine });
  try {
    const res = await post(app.app, '/galaxy/api/auth/register', { username: uniqueName('ver'), password: 'una-clave-larga' });
    const cookie = sessionCookie(res);
    const pull = await post(app.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 1, pay: 'signal' }, { cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(pull.statusCode).toBe(200);
    const galaxyId = (pull.json() as PullResponse).pulls[0]!.id;
    const row = await ctx.db.selectFrom('galaxy.gacha_pulls').select('config_version').where('galaxy_id', '=', galaxyId).executeTakeFirstOrThrow();
    expect(row.config_version).toBe(drawn);
  } finally {
    await app.close();
  }
});
