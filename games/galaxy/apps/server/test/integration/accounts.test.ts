import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  UsernameReservedError,
  UsernameTakenError,
  findAccountByUsername,
  registerAccount,
} from '../../src/auth/accounts';
import { verifyPassword } from '../../src/auth/password';
import { RateLimitedError, hitRateLimit } from '../../src/ratelimit';
import { testApp, uniqueName } from '../helpers';

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

test('registro normaliza y respeta reservados (Review Focus 1)', async () => {
  for (const username of ['RAYELUS', 'Rayelus']) {
    await expect(registerAccount(ctx.db, { username, password: 'una-clave-larga' })).rejects.toBeInstanceOf(
      UsernameReservedError,
    );
  }
  const name = uniqueName('SonDa');
  const { id } = await registerAccount(ctx.db, { username: name, password: 'una-clave-larga' });
  const row = await findAccountByUsername(ctx.db, name.toUpperCase());
  expect(row?.id).toBe(id);
  expect(row?.username).toBe(name.toLowerCase());
  expect(await verifyPassword(row!.password_hash, 'una-clave-larga')).toBe(true);
});

test('nombre repetido, aunque cambien las mayúsculas → UsernameTakenError', async () => {
  const name = uniqueName('dup');
  await registerAccount(ctx.db, { username: name, password: 'una-clave-larga' });
  await expect(
    registerAccount(ctx.db, { username: name.toUpperCase(), password: 'una-clave-larga' }),
  ).rejects.toBeInstanceOf(UsernameTakenError);
});

test('dos registros simultáneos del mismo nombre: uno gana y el otro es UsernameTakenError', async () => {
  const name = uniqueName('race');
  const results = await Promise.allSettled([
    registerAccount(ctx.db, { username: name, password: 'una-clave-larga' }),
    registerAccount(ctx.db, { username: name, password: 'una-clave-larga' }),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toBeInstanceOf(UsernameTakenError);
});

test('allowReserved permite crear un nombre reservado solo con la opción', async () => {
  await ctx.db
    .transaction()
    .execute(async (trx) => {
      const { id } = await registerAccount(
        trx,
        { username: 'rayelus', password: 'una-clave-larga' },
        { allowReserved: true },
      );
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      throw new Error('rollback');
    })
    .catch((e: Error) => expect(e.message).toBe('rollback'));
  expect(await findAccountByUsername(ctx.db, 'rayelus')).toBeUndefined();
});

test('entradas inválidas lanzan antes de tocar la BD', async () => {
  await expect(registerAccount(ctx.db, { username: 'ab', password: 'una-clave-larga' })).rejects.toThrow();
  await expect(registerAccount(ctx.db, { username: uniqueName('corta'), password: 'corta' })).rejects.toThrow();
});

test('hitRateLimit lanza RateLimitedError al pasar el máximo y cada sujeto lleva su cuenta', async () => {
  const s = uniqueName('ip');
  await hitRateLimit(ctx.db, s, 't3', 2, 60);
  await hitRateLimit(ctx.db, s, 't3', 2, 60);
  await expect(hitRateLimit(ctx.db, s, 't3', 2, 60)).rejects.toBeInstanceOf(RateLimitedError);
  await expect(hitRateLimit(ctx.db, uniqueName('ip'), 't3', 2, 60)).resolves.toBeUndefined();
});

test('galaxy_api no ve el foro (conexión real)', async () => {
  await expect(sql`select 1 from public.members limit 1`.execute(ctx.db)).rejects.toThrow(/permission denied/);
});
