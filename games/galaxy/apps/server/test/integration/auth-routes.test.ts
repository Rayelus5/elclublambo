import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { hashToken } from '../../src/auth/tokens';
import { get, post, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

const REG = '/galaxy/api/auth/register';
const LOGIN = '/galaxy/api/auth/login';
const LOGOUT = '/galaxy/api/auth/logout';
const ME = '/galaxy/api/auth/me';
const PASS = 'una-clave-larga';

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function registered(prefix = 'piloto') {
  const username = uniqueName(prefix);
  const res = await post(ctx.app, REG, { username, password: PASS });
  expect(res.statusCode).toBe(201);
  return { username: username.toLowerCase(), cookie: sessionCookie(res), me: res.json() };
}

test('registro → 201 con el perfil, cookie gs_sid con atributos exactos y /me', async () => {
  const username = uniqueName('Nueva');
  const res = await post(ctx.app, REG, { username, password: PASS });
  expect(res.statusCode).toBe(201);
  expect(res.json()).toMatchObject({ username: username.toLowerCase(), roles: [], mfa: false });
  const c = res.cookies.find((k) => k.name === 'gs_sid')!;
  expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/galaxy' });
  expect(c.maxAge).toBe(30 * 24 * 3600);
  const me = await get(ctx.app, ME, { cookie: c.value });
  expect(me.statusCode).toBe(200);
  // /me also says the account level (M5a): a new account is level 1.
  expect(me.json()).toEqual({ id: res.json().id, username: username.toLowerCase(), roles: [], mfa: false, level: 1 });
});

test('la BD guarda el sha256 del token, nunca el token', async () => {
  const { cookie } = await registered();
  const rows = await ctx.db
    .selectFrom('galaxy.sessions')
    .select(['token_hash'])
    .where('token_hash', '=', hashToken(cookie))
    .execute();
  expect(rows).toHaveLength(1);
  const raw = await ctx.db
    .selectFrom('galaxy.sessions')
    .select('id')
    .where('token_hash', '=', Buffer.from(cookie, 'base64url'))
    .execute();
  expect(raw).toHaveLength(0);
});

test('registro con datos inválidos → 400 invalid_input; nombre reservado → 409 username_reserved', async () => {
  expect((await post(ctx.app, REG, { username: 'ab', password: PASS })).json()).toEqual({ error: 'invalid_input' });
  expect((await post(ctx.app, REG, { username: uniqueName('x'), password: 'corta' })).statusCode).toBe(400);
  const reserved = await post(ctx.app, REG, { username: 'Perkins', password: PASS });
  expect(reserved.statusCode).toBe(409);
  expect(reserved.json()).toEqual({ error: 'username_reserved' });
});

test('dos registros simultáneos del mismo nombre → 201 y 409 username_taken (Review Focus 2)', async () => {
  const username = uniqueName('carrera');
  const [a, b] = await Promise.all([
    post(ctx.app, REG, { username, password: PASS }),
    post(ctx.app, REG, { username, password: PASS }),
  ]);
  expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  expect((a.statusCode === 409 ? a : b).json()).toEqual({ error: 'username_taken' });
});

test('el 6.º registro desde la misma IP en una hora → 429 rate_limited', async () => {
  const ip = randomIp();
  for (let i = 0; i < 5; i++) {
    expect((await post(ctx.app, REG, { username: uniqueName('ip'), password: PASS }, { ip })).statusCode).toBe(201);
  }
  const res = await post(ctx.app, REG, { username: uniqueName('ip'), password: PASS }, { ip });
  expect(res.statusCode).toBe(429);
  expect(res.json()).toEqual({ error: 'rate_limited' });
});

test('login con el nombre en mayúsculas → 200 status ok y sesión nueva', async () => {
  const { username } = await registered('Mayus');
  const res = await post(ctx.app, LOGIN, { username: username.toUpperCase(), password: PASS });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ status: 'ok', me: { username, roles: [], mfa: false } });
  const me = await get(ctx.app, ME, { cookie: sessionCookie(res) });
  expect(me.json().username).toBe(username);
});

test('contraseña mala y usuario inexistente dan el mismo 401 invalid_credentials', async () => {
  const { username } = await registered();
  const bad = await post(ctx.app, LOGIN, { username, password: 'otra-clave-larga' });
  const ghost = await post(ctx.app, LOGIN, { username: uniqueName('fantasma'), password: PASS });
  for (const res of [bad, ghost]) {
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
    expect(res.cookies.find((c) => c.name === 'gs_sid' && c.value)).toBeUndefined();
  }
});

test('cuenta baneada → 403 banned, y su sesión abierta deja de valer', async () => {
  const { username, cookie } = await registered('baneo');
  await ctx.db
    .updateTable('galaxy.accounts')
    .set({ banned_until: sql<Date>`now() + interval '1 day'`, ban_reason: 'test' })
    .where('username', '=', username)
    .execute();
  const res = await post(ctx.app, LOGIN, { username, password: PASS });
  expect(res.statusCode).toBe(403);
  expect(res.json()).toEqual({ error: 'banned' });
  expect((await get(ctx.app, ME, { cookie })).statusCode).toBe(401);
});

test('el 11.º intento del mismo usuario desde la misma IP → 429, pero el dueño entra desde otra IP (revisión final M9)', async () => {
  const { username } = await registered('fuerza');
  const attacker = randomIp();
  for (let i = 0; i < 10; i++) {
    expect((await post(ctx.app, LOGIN, { username, password: 'mala-clave-larga' }, { ip: attacker })).statusCode).toBe(401);
  }
  const res = await post(ctx.app, LOGIN, { username: username.toUpperCase(), password: PASS }, { ip: attacker });
  expect(res.statusCode).toBe(429);
  expect(res.json()).toEqual({ error: 'rate_limited' });
  // The real owner, from their own address, is not locked out by someone else's attempts.
  expect((await post(ctx.app, LOGIN, { username, password: PASS }, { ip: randomIp() })).statusCode).toBe(200);
});

test('un ataque repartido entre muchas IPs topa con el techo por usuario: 10 × el límite por usuario e IP', async () => {
  const { username } = await registered('reparto');
  for (let i = 0; i < 100; i++) {
    expect((await post(ctx.app, LOGIN, { username, password: 'mala-clave-larga' }, { ip: randomIp() })).statusCode).toBe(401);
  }
  expect((await post(ctx.app, LOGIN, { username, password: PASS }, { ip: randomIp() })).statusCode).toBe(429);
});

test('el 31.º login desde la misma IP en 10 min → 429', async () => {
  const ip = randomIp();
  for (let i = 0; i < 30; i++) {
    expect((await post(ctx.app, LOGIN, { username: uniqueName('nadie'), password: PASS }, { ip })).statusCode).toBe(401);
  }
  expect((await post(ctx.app, LOGIN, { username: uniqueName('nadie'), password: PASS }, { ip })).statusCode).toBe(429);
});

test('logout revoca: la cookie vieja da 401 y la respuesta borra la cookie (Review Focus 3)', async () => {
  const { cookie } = await registered('salir');
  const out = await post(ctx.app, LOGOUT, undefined, { cookie });
  expect(out.statusCode).toBe(204);
  expect(out.cookies.find((c) => c.name === 'gs_sid')?.maxAge).toBe(0);
  const me = await get(ctx.app, ME, { cookie });
  expect(me.statusCode).toBe(401);
  expect(me.json()).toEqual({ error: 'unauthenticated' });
  expect(me.cookies.find((c) => c.name === 'gs_sid')?.maxAge).toBe(0);
});

test('logout sin sesión → 204 igualmente', async () => {
  expect((await post(ctx.app, LOGOUT)).statusCode).toBe(204);
});

test('sesión caducada → 401 unauthenticated', async () => {
  const { cookie } = await registered('caduca');
  await ctx.db
    .updateTable('galaxy.sessions')
    .set({ expires_at: sql<Date>`now() - interval '1 second'` })
    .where('token_hash', '=', hashToken(cookie))
    .execute();
  expect((await get(ctx.app, ME, { cookie })).statusCode).toBe(401);
});

test('sin cookie o con una cookie inventada → 401', async () => {
  expect((await get(ctx.app, ME)).statusCode).toBe(401);
  expect((await get(ctx.app, ME, { cookie: 'inventada' })).statusCode).toBe(401);
});

test('last_seen_at no se reescribe en cada petición (como mucho cada 5 min)', async () => {
  const { cookie } = await registered('visto');
  const read = () =>
    ctx.db
      .selectFrom('galaxy.sessions')
      .select('last_seen_at')
      .where('token_hash', '=', hashToken(cookie))
      .executeTakeFirstOrThrow();
  const first = (await read()).last_seen_at.getTime();
  await get(ctx.app, ME, { cookie });
  expect((await read()).last_seen_at.getTime()).toBe(first);
  await ctx.db
    .updateTable('galaxy.sessions')
    .set({ last_seen_at: sql<Date>`now() - interval '6 minutes'` })
    .where('token_hash', '=', hashToken(cookie))
    .execute();
  await get(ctx.app, ME, { cookie });
  expect(Date.now() - (await read()).last_seen_at.getTime()).toBeLessThan(60_000);
});
