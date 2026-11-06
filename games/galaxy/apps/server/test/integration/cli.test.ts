import { afterAll, beforeAll, expect, test } from 'vitest';
import { decryptSecret } from '../../src/auth/totp';
import { verifyPassword } from '../../src/auth/password';
import { findAccountByUsername } from '../../src/auth/accounts';
import { runCli } from '../../src/cli';
import { TEST_TOTP_KEY, testApp, testEnv, uniqueName } from '../helpers';

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

test('create-admin rayelus: superadmin con TOTP cifrado y auditoría, sin dejar rastro (transacción revertida)', async () => {
  const lines: string[] = [];
  await ctx.db
    .transaction()
    .execute(async (trx) => {
      const code = await runCli(['create-admin', 'rayelus', '--role', 'superadmin', '--json'], {
        db: trx,
        env: testEnv(),
        out: (s) => lines.push(s),
      });
      expect(code).toBe(0);
      const out = JSON.parse(lines.join('\n'));
      expect(out.username).toBe('rayelus');
      expect(out.password).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(out.totpUri).toContain('otpauth://totp/');

      const account = await findAccountByUsername(trx, 'rayelus');
      expect(await verifyPassword(account!.password_hash, out.password)).toBe(true);
      const roles = await trx.selectFrom('galaxy.account_roles').select('role').where('account_id', '=', account!.id).execute();
      expect(roles.map((r) => r.role)).toEqual(['superadmin']);
      const totp = await trx.selectFrom('galaxy.admin_totp').selectAll().where('account_id', '=', account!.id).executeTakeFirstOrThrow();
      expect(decryptSecret(TEST_TOTP_KEY, totp.secret_enc)).toBe(out.totpSecret);
      const audit = await trx
        .selectFrom('galaxy.admin_audit_log')
        .selectAll()
        .where('target_id', '=', account!.id)
        .execute();
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_label: 'cli', actor_id: null, action: 'account.admin_created', target_type: 'account' });
      expect(JSON.stringify(audit[0])).not.toContain(out.password);
      expect(JSON.stringify(audit[0])).not.toContain(out.totpSecret);
      throw new Error('rollback');
    })
    .catch((e: Error) => expect(e.message).toBe('rollback'));
  expect(await findAccountByUsername(ctx.db, 'rayelus')).toBeUndefined();
});

test('create-admin en texto imprime usuario, contraseña, secreto y URI', async () => {
  const lines: string[] = [];
  const name = uniqueName('txt');
  expect(await runCli(['create-admin', name], { db: ctx.db, env: testEnv(), out: (s) => lines.push(s) })).toBe(0);
  const text = lines.join('\n');
  expect(text).toContain(name.toLowerCase());
  expect(text).toMatch(/otpauth:\/\/totp\//);
  const roles = await ctx.db
    .selectFrom('galaxy.account_roles as r')
    .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
    .select('r.role')
    .where('a.username', '=', name.toLowerCase())
    .execute();
  expect(roles.map((r) => r.role)).toEqual(['admin']);
});

test.each([
  [['create-admin', 'ab']],
  [['create-admin']],
  [['create-admin', uniqueName('rol'), '--role', 'dios']],
  [['issue-reset-code']],
  [['borrar-todo']],
  [[]],
])('uso incorrecto %j → código 1 con mensaje', async (argv) => {
  const lines: string[] = [];
  expect(await runCli(argv, { db: ctx.db, env: testEnv(), out: (s) => lines.push(s) })).toBe(1);
  expect(lines.join('\n')).toMatch(/uso|usage/i);
});

test('create-admin de un nombre que ya existe → código 1 sin tocar la cuenta', async () => {
  const name = uniqueName('dos');
  expect(await runCli(['create-admin', name], { db: ctx.db, env: testEnv(), out: () => {} })).toBe(0);
  const before = await findAccountByUsername(ctx.db, name);
  const lines: string[] = [];
  expect(await runCli(['create-admin', name], { db: ctx.db, env: testEnv(), out: (s) => lines.push(s) })).toBe(1);
  expect(lines.join('\n')).toMatch(/existe/);
  expect((await findAccountByUsername(ctx.db, name))?.password_hash).toBe(before?.password_hash);
});

test('issue-reset-code imprime un código para una cuenta existente y falla para una inexistente', async () => {
  const name = uniqueName('rst');
  await runCli(['create-admin', name], { db: ctx.db, env: testEnv(), out: () => {} });
  const lines: string[] = [];
  expect(await runCli(['issue-reset-code', name], { db: ctx.db, env: testEnv(), out: (s) => lines.push(s) })).toBe(0);
  expect(lines.join('\n')).toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  expect(await runCli(['issue-reset-code', uniqueName('nadie')], { db: ctx.db, env: testEnv(), out: () => {} })).toBe(1);
});
