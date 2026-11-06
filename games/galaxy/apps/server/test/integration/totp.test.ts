import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { hashToken } from '../../src/auth/tokens';
import { createAdminViaCli, get, post, randomIp, sessionCookie, testApp, totpNow } from '../helpers';

const LOGIN = '/galaxy/api/auth/login';
const TOTP_URL = '/galaxy/api/auth/totp';
const ME = '/galaxy/api/auth/me';

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function challengeFor(username: string, password: string): Promise<string> {
  const login = await post(ctx.app, LOGIN, { username, password });
  expect(login.statusCode).toBe(200);
  const body = login.json();
  expect(body.status).toBe('totp_required');
  expect(login.cookies.find((c) => c.name === 'gs_sid')).toBeUndefined();
  return body.challenge;
}

test('admin: login → totp_required sin cookie; código correcto → sesión mfa de 12 h', async () => {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const challenge = await challengeFor(username, password);
  const res = await post(ctx.app, TOTP_URL, { challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ username, mfa: true, roles: ['admin'] });
  const c = res.cookies.find((k) => k.name === 'gs_sid')!;
  expect(c.maxAge).toBe(12 * 3600);
  expect((await get(ctx.app, ME, { cookie: c.value })).json()).toMatchObject({ mfa: true, roles: ['admin'] });
});

test('el mismo código no vale dos veces, ni con otro desafío (Review Focus 4)', async () => {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'superadmin');
  const code = totpNow(totpSecret);
  const first = await post(ctx.app, TOTP_URL, { challenge: await challengeFor(username, password), code });
  expect(first.statusCode).toBe(200);
  const second = await post(ctx.app, TOTP_URL, { challenge: await challengeFor(username, password), code });
  expect(second.statusCode).toBe(401);
  expect(second.json()).toEqual({ error: 'invalid_totp' });
});

test('código incorrecto → 401 invalid_totp y el desafío sigue valiendo para reintentar', async () => {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'moderator');
  const challenge = await challengeFor(username, password);
  const wrong = totpNow(totpSecret) === '000000' ? '111111' : '000000';
  const bad = await post(ctx.app, TOTP_URL, { challenge, code: wrong });
  expect(bad.statusCode).toBe(401);
  expect(bad.json()).toEqual({ error: 'invalid_totp' });
  const ok = await post(ctx.app, TOTP_URL, { challenge, code: totpNow(totpSecret) });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().roles).toEqual(['moderator']);
});

test('un desafío ya usado → 401 challenge_expired', async () => {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const challenge = await challengeFor(username, password);
  expect((await post(ctx.app, TOTP_URL, { challenge, code: totpNow(totpSecret) })).statusCode).toBe(200);
  const again = await post(ctx.app, TOTP_URL, { challenge, code: totpNow(totpSecret, new Date(Date.now() + 30_000)) });
  expect(again.statusCode).toBe(401);
  expect(again.json()).toEqual({ error: 'challenge_expired' });
});

test('desafío caducado o inventado → 401 challenge_expired', async () => {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const challenge = await challengeFor(username, password);
  await ctx.db
    .updateTable('galaxy.login_challenges')
    .set({ expires_at: sql<Date>`now() - interval '1 second'` })
    .where('token_hash', '=', hashToken(challenge))
    .execute();
  const res = await post(ctx.app, TOTP_URL, { challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(401);
  expect(res.json()).toEqual({ error: 'challenge_expired' });
  expect((await post(ctx.app, TOTP_URL, { challenge: 'inventado', code: '123456' })).json()).toEqual({
    error: 'challenge_expired',
  });
});

test('el 11.º intento de código de la misma cuenta en 10 min → 429', async () => {
  const { username, password } = await createAdminViaCli(ctx.db, 'admin');
  const challenge = await challengeFor(username, password);
  for (let i = 0; i < 10; i++) {
    const res = await post(ctx.app, TOTP_URL, { challenge, code: '000000' }, { ip: randomIp() });
    expect([401]).toContain(res.statusCode);
  }
  expect((await post(ctx.app, TOTP_URL, { challenge, code: '000000' })).statusCode).toBe(429);
});

test('un jugador normal sigue entrando sin TOTP', async () => {
  const reg = await post(ctx.app, '/galaxy/api/auth/register', { username: `jug_${Date.now() % 1e8}`, password: 'una-clave-larga' });
  expect(reg.statusCode).toBe(201);
  expect(sessionCookie(reg)).toBeTruthy();
});
