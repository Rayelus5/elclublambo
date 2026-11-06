import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { registerAccount } from '../../src/auth/accounts';
import { inTransaction } from '../../src/db/tx';
import { runOperation } from '../../src/economy/operations';
import { credit, debit, getWallet } from '../../src/economy/wallet';
import { HttpError } from '../../src/errors';
import { testApp, uniqueName } from '../helpers';

// GDD §11.3: the server decides; every action is an idempotent operation; the ledger only grows; never below 0.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

const newAccount = async () => (await registerAccount(ctx.db, { username: uniqueName('eco'), password: 'una-clave-larga' })).id;

test('una cuenta nueva tiene el monedero a cero y el abono queda en el libro', async () => {
  const id = await newAccount();
  expect(await getWallet(ctx.db, id)).toEqual({ coins: 0, dust: 0, signal: 0 });
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', 250, 'prueba', { test: true }));
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'signal:nova', 2, 'prueba'));
  expect(await getWallet(ctx.db, id)).toEqual({ coins: 250, dust: 0, signal: 0, 'signal:nova': 2 });
  const rows = await ctx.db.selectFrom('galaxy.ledger').selectAll().where('account_id', '=', id).orderBy('id').execute();
  expect(rows.map((r) => [r.currency, Number(r.delta), Number(r.balance_after), r.reason])).toEqual([
    ['coins', 250, 250, 'prueba'],
    ['signal:nova', 2, 2, 'prueba'],
  ]);
});

test('cargar más de lo que hay es insufficient_funds y no deja rastro', async () => {
  const id = await newAccount();
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', 50, 'prueba'));
  await expect(inTransaction(ctx.db, (trx) => debit(trx, id, 'coins', 51, 'tirada'))).rejects.toMatchObject({
    status: 402,
    code: 'insufficient_funds',
  });
  expect((await getWallet(ctx.db, id)).coins).toBe(50);
  expect(await ctx.db.selectFrom('galaxy.ledger').select('id').where('account_id', '=', id).execute()).toHaveLength(1);
});

test('20 cargos simultáneos de 100 sobre 1 000: pasan exactamente 10 y el saldo queda en 0 (Review Focus 1)', async () => {
  const id = await newAccount();
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', 1000, 'prueba'));
  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () => inTransaction(ctx.db, (trx) => debit(trx, id, 'coins', 100, 'tirada'))),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
  for (const r of results.filter((x) => x.status === 'rejected')) {
    expect((r as PromiseRejectedResult).reason).toBeInstanceOf(HttpError);
  }
  expect((await getWallet(ctx.db, id)).coins).toBe(0);
});

test('repetir una operación devuelve el mismo resultado sin volver a ejecutarla', async () => {
  const id = await newAccount();
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', 500, 'prueba'));
  const key = randomUUID();
  let runs = 0;
  const op = () =>
    runOperation(ctx.db, id, key, 'test', 'hash-a', async (trx) => {
      runs++;
      return { left: await debit(trx, id, 'coins', 100, 'tirada', {}, key) };
    });
  const first = await op();
  const second = await op();
  expect(first).toEqual({ left: 400 });
  expect(second).toEqual(first);
  expect(runs).toBe(1);
  expect((await getWallet(ctx.db, id)).coins).toBe(400);
  await expect(runOperation(ctx.db, id, key, 'test', 'hash-b', async () => ({}))).rejects.toMatchObject({
    status: 409,
    code: 'idempotency_conflict',
  });
});

test('la misma operación lanzada a la vez se ejecuta una sola vez', async () => {
  const id = await newAccount();
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', 500, 'prueba'));
  const key = randomUUID();
  let runs = 0;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      runOperation(ctx.db, id, key, 'test', 'same', async (trx) => {
        runs++;
        return { left: await debit(trx, id, 'coins', 100, 'tirada', {}, key) };
      }),
    ),
  );
  expect(runs).toBe(1);
  expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  expect((await getWallet(ctx.db, id)).coins).toBe(400);
});

test('si la operación falla, no se guarda: un reintento vuelve a intentarlo', async () => {
  const id = await newAccount();
  const key = randomUUID();
  await expect(
    runOperation(ctx.db, id, key, 'test', 'h', async (trx) => debit(trx, id, 'coins', 1, 'tirada')),
  ).rejects.toMatchObject({ code: 'insufficient_funds' });
  await inTransaction(ctx.db, (trx) => credit(trx, id, 'coins', 5, 'prueba'));
  expect(await runOperation(ctx.db, id, key, 'test', 'h', async (trx) => debit(trx, id, 'coins', 1, 'tirada'))).toBe(4);
});
