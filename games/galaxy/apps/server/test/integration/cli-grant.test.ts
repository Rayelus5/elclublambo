import { afterAll, beforeAll, expect, test } from 'vitest';
import { registerAccount } from '../../src/auth/accounts';
import { runCli } from '../../src/cli';
import { getWallet } from '../../src/economy/wallet';
import { testApp, testEnv, uniqueName } from '../helpers';

// Until incursions pay coins (M3), PRE testers get currency from the container CLI. Every grant is audited.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

const cli = async (argv: string[]) => {
  const lines: string[] = [];
  const code = await runCli(argv, { db: ctx.db, env: testEnv(), out: (s) => lines.push(s) });
  return { code, out: lines.join('\n') };
};

test('grant abona la moneda, la apunta en el libro y lo audita', async () => {
  const username = uniqueName('grant');
  const { id } = await registerAccount(ctx.db, { username, password: 'una-clave-larga' });
  const r = await cli(['grant', username, 'coins', '1500', '--reason', 'pruebas en PRE']);
  expect(r.code).toBe(0);
  expect(r.out).toContain('1500');
  expect((await getWallet(ctx.db, id)).coins).toBe(1500);
  const audit = await ctx.db
    .selectFrom('galaxy.admin_audit_log')
    .selectAll()
    .where('target_id', '=', id)
    .where('action', '=', 'wallet.grant')
    .executeTakeFirstOrThrow();
  expect(audit.reason).toBe('pruebas en PRE');
  expect(audit.actor_label).toBe('cli');
  expect(await cli(['grant', username, 'signal', '-1', '--reason', 'corregir'])).toMatchObject({ code: 1 });
  expect((await cli(['grant', username, 'dust', '-5', '--reason', 'corregir'])).code).toBe(1); // below 0
  expect((await cli(['grant', username, 'coins', '-500', '--reason', 'corregir'])).code).toBe(0);
  expect((await getWallet(ctx.db, id)).coins).toBe(1000);
});

test('grant rechaza monedas desconocidas, cantidades no enteras, cuentas que no existen y falta de motivo', async () => {
  const username = uniqueName('grant');
  await registerAccount(ctx.db, { username, password: 'una-clave-larga' });
  expect((await cli(['grant', username, 'gems', '10', '--reason', 'x'])).code).toBe(1);
  expect((await cli(['grant', username, 'coins', '1.5', '--reason', 'x'])).code).toBe(1);
  expect((await cli(['grant', username, 'coins', '0', '--reason', 'x'])).code).toBe(1);
  expect((await cli(['grant', 'nadie_existe_x', 'coins', '10', '--reason', 'x'])).code).toBe(1);
  expect((await cli(['grant', username, 'coins', '10'])).code).toBe(1);
});
