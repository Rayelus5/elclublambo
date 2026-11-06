import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { InvalidResetCodeError, issueResetCode, redeemResetCode } from '../../src/auth/recovery';
import { get, post, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

const REDEEM = '/galaxy/api/auth/reset/redeem';
const actor = { id: null, label: 'test' };

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('olvido');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'clave-antigua-1' });
  expect(res.statusCode).toBe(201);
  return { username: username.toLowerCase(), cookie: sessionCookie(res) };
}

test('el código tiene 16 caracteres sin I L O U en grupos de 4 y queda auditado', async () => {
  const { username } = await player();
  const code = await issueResetCode(ctx.db, username, actor);
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTVWXYZ0-9]{4}(-[ABCDEFGHJKMNPQRSTVWXYZ0-9]{4}){3}$/);
  const audit = await ctx.db
    .selectFrom('galaxy.admin_audit_log')
    .selectAll()
    .where('action', '=', 'account.reset_code_issued')
    .orderBy('id', 'desc')
    .executeTakeFirstOrThrow();
  expect(audit).toMatchObject({ actor_label: 'test', target_type: 'account' });
  expect(JSON.stringify(audit)).not.toContain(code.replaceAll('-', ''));
});

test('canjear cambia la contraseña y revoca las sesiones viejas (Review Focus 3)', async () => {
  const { username, cookie } = await player();
  const code = await issueResetCode(ctx.db, username, actor);
  const res = await post(ctx.app, REDEEM, { username: username.toUpperCase(), code: code.toLowerCase(), newPassword: 'clave-nueva-22' });
  expect(res.statusCode).toBe(204);
  expect((await get(ctx.app, '/galaxy/api/auth/me', { cookie })).statusCode).toBe(401);
  expect((await post(ctx.app, '/galaxy/api/auth/login', { username, password: 'clave-antigua-1' })).statusCode).toBe(401);
  expect((await post(ctx.app, '/galaxy/api/auth/login', { username, password: 'clave-nueva-22' })).statusCode).toBe(200);
});

test('un código usado, caducado, de otra cuenta o inventado → 400 invalid_reset_code', async () => {
  const a = await player();
  const b = await player();
  const used = await issueResetCode(ctx.db, a.username, actor);
  await redeemResetCode(ctx.db, { username: a.username, code: used, newPassword: 'clave-nueva-22' }, new Date());
  const expired = await issueResetCode(ctx.db, a.username, actor);
  await sql`update galaxy.reset_codes set expires_at = now() - interval '1 second' where used_at is null and account_id = (select id from galaxy.accounts where username = ${a.username})`.execute(ctx.db);
  const other = await issueResetCode(ctx.db, b.username, actor);
  for (const [username, code] of [
    [a.username, used],
    [a.username, expired],
    [a.username, other],
    [a.username, 'AAAA-AAAA-AAAA-AAAA'],
  ] as const) {
    const res = await post(ctx.app, REDEEM, { username, code, newPassword: 'clave-nueva-33' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_reset_code' });
  }
  await expect(
    redeemResetCode(ctx.db, { username: uniqueName('nadie'), code: other, newPassword: 'clave-nueva-33' }, new Date()),
  ).rejects.toBeInstanceOf(InvalidResetCodeError);
});

test('el 11.º canje desde la misma IP en una hora → 429', async () => {
  const ip = randomIp();
  for (let i = 0; i < 10; i++) {
    const res = await post(ctx.app, REDEEM, { username: 'nadie_aqui', code: 'AAAA-AAAA-AAAA-AAAA', newPassword: 'clave-nueva-33' }, { ip });
    expect(res.statusCode).toBe(400);
  }
  const res = await post(ctx.app, REDEEM, { username: 'nadie_aqui', code: 'AAAA-AAAA-AAAA-AAAA', newPassword: 'clave-nueva-33' }, { ip });
  expect(res.statusCode).toBe(429);
});
