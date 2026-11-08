import { randomUUID } from 'node:crypto';
import { CONFIG_KEYS, PROBE_TEST, parseConfig } from '@galaxy/shared';
import type { ControlledTransaction, Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createConfigService } from '../../src/config/service';
import { createDb } from '../../src/db';
import type { DB } from '../../src/db/schema';
import { createAdminViaCli, get, post, randomIp, sessionCookie, testApp, testEnv, totpNow, uniqueName } from '../helpers';

// The live config from the admin panel (GDD §16.3; M6b): every key with what is live (or its default), a draft checked
// against its schema with each issue at its path, publishing with a reason and the admin's password (an invalid draft
// is refused with its issues), and the switches that close the market, the swaps and the chat at once.
// The local DB is the user's and its live config is never published from tests: the app runs the real config service
// on one transaction that is rolled back when the file ends, so every publish here is seen by this file only and none
// is ever committed (accounts and sessions go through the app's own pool, like every integration test).

let configDb: Kysely<DB>;
let trx: ControlledTransaction<DB>;

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
let admin: { cookie: string; password: string; username: string };

async function adminSession() {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  return { cookie: sessionCookie(res), password, username };
}

beforeAll(async () => {
  configDb = createDb(testEnv().DATABASE_URL, { max: 1 });
  trx = await configDb.startTransaction().execute();
  ctx = await testApp({ config: createConfigService(trx) });
  admin = await adminSession();
});
afterAll(async () => {
  await ctx.close();
  await trx.rollback().execute();
  await configDb.destroy();
});

const versionsOf = async (key: string) => (await trx.selectFrom('galaxy.game_config_versions').select('version').where('key', '=', key).execute()).length;
const lastVersion = async (key: string) =>
  (await trx.selectFrom('galaxy.game_config_versions').select('version').where('key', '=', key).orderBy('version', 'desc').executeTakeFirst())?.version ?? 0;

const A = (p: string) => `/galaxy/api/admin/config${p}`;
const publish = (key: string, body: object) => post(ctx.app, A(`/${key}`), body, { cookie: admin.cookie });

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('cfg'), password: 'una-clave-larga' }, { ip: randomIp() });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return cookie;
}

describe('las claves', () => {
  test('todas, con lo que está vivo o su valor por defecto', async () => {
    const keys = (await get(ctx.app, A('/keys'), { cookie: admin.cookie })).json() as { key: string; version: number; data: unknown }[];
    expect(keys.map((k) => k.key).sort()).toEqual([...CONFIG_KEYS].sort());
    const chat = keys.find((k) => k.key === 'chat')!;
    expect(chat.data).toEqual(parseConfig('chat', {}));
    expect((await get(ctx.app, A('/keys'), { cookie: await player() })).statusCode).toBe(403);
  });

  test('un borrador se comprueba con su esquema, cada problema en su ruta', async () => {
    expect((await post(ctx.app, A('/chat/validate'), { data: { maxLength: 5 } }, { cookie: admin.cookie })).json()).toEqual({ ok: false, issues: [expect.objectContaining({ path: 'maxLength' })] });
    expect((await post(ctx.app, A('/chat/validate'), { data: { maxLength: 300 } }, { cookie: admin.cookie })).json()).toEqual({ ok: true, issues: [] });
  });
});

describe('publicar', () => {
  test('pide motivo y contraseña; lo inválido se rechaza con sus problemas; lo válido es una versión nueva con autor', async () => {
    expect((await publish('chat', { data: { maxLength: 300 }, reason: 'Más largo' })).statusCode).toBe(400);
    expect((await publish('chat', { data: { maxLength: 300 }, reason: 'Más largo', password: 'mal' })).json()).toEqual({ error: 'password_wrong' });
    const bad = await publish('chat', { data: { maxLength: 5 }, reason: 'Más corto', password: admin.password });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'config_invalid', issues: [expect.objectContaining({ path: 'maxLength' })] });
    const ok = await publish('chat', { data: { maxLength: 300 }, reason: 'Más largo', password: admin.password });
    expect(ok.statusCode).toBe(201);
    const keys = (await get(ctx.app, A('/keys'), { cookie: admin.cookie })).json() as { key: string; version: number; author: string | null; note: string | null; data: { maxLength: number } }[];
    expect(keys.find((k) => k.key === 'chat')).toMatchObject({ version: (ok.json() as { version: number }).version, author: admin.username, note: 'Más largo', data: { maxLength: 300 } });
  });

  test('una contraseña equivocada da 401 y no publica; diez seguidas cierran las sesiones de ese admin (Review Focus 3)', async () => {
    const other = await adminSession();
    const before = await versionsOf('chat');
    const wrong = () => post(ctx.app, A('/chat'), { data: { maxLength: 250 }, reason: 'Prueba', password: 'mal' }, { cookie: other.cookie });
    const first = await wrong();
    expect(first.statusCode).toBe(401);
    expect(first.json()).toEqual({ error: 'password_wrong' });
    expect(await versionsOf('chat')).toBe(before);
    for (let i = 0; i < 9; i++) expect((await wrong()).statusCode).toBe(401);
    expect((await wrong()).statusCode).toBe(429);
    expect((await get(ctx.app, A('/keys'), { cookie: other.cookie })).statusCode).toBe(401);
    expect(await versionsOf('chat')).toBe(before);
  });

  test('un borrador parcial se junta con lo publicado: lo que el panel da por bueno, el servidor lo publica', async () => {
    const season = { startsAt: '2027-01-01T00:00:00.000Z', endsAt: '2027-02-15T00:00:00.000Z' };
    expect((await publish('season', { data: season, reason: 'Temporada 2', password: admin.password })).statusCode).toBe(201);
    const later = await publish('season', { data: { startsAt: '2027-01-15T00:00:00.000Z' }, reason: 'Empieza más tarde', password: admin.password });
    expect(later.statusCode).toBe(201);
    const keys = (await get(ctx.app, A('/keys'), { cookie: admin.cookie })).json() as { key: string; data: { startsAt: string; endsAt: string } }[];
    expect(keys.find((k) => k.key === 'season')!.data).toMatchObject({ startsAt: '2027-01-15T00:00:00.000Z', endsAt: '2027-02-15T00:00:00.000Z' });
  });

  test('lo que no se puede publicar se rechaza con sus problemas, también un escáner de evento sin destacada (Review Focus 1)', async () => {
    const gacha = parseConfig('gacha', {});
    // Since M7e-1 event scanners are published, but one without its featured trait is still refused.
    const event = { id: 'nova', kind: 'event', name: 'Lluvia de cometas', pityGroup: 'event-nova', currency: 'signal:nova' };
    const before = await versionsOf('gacha');
    const res = await publish('gacha', { data: { banners: [...gacha.banners, event] }, reason: 'Evento', password: admin.password });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'config_invalid', issues: [{ path: 'banners.1', message: expect.any(String) }] });
    expect(await versionsOf('gacha')).toBe(before);
  });

  test('publicar sobre una versión que ya no es la viva da 409 y no pisa lo que otro publicó', async () => {
    const first = await publish('chat', { data: { history: 40 }, reason: 'Primero', password: admin.password });
    const base = (first.json() as { version: number }).version;
    expect((await publish('chat', { data: { hideAfter: 4 }, baseVersion: base, reason: 'Otro admin', password: admin.password })).statusCode).toBe(201);
    const stale = await publish('chat', { data: { history: 60 }, baseVersion: base, reason: 'Tarde', password: admin.password });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'config_conflict' });
    expect(await lastVersion('chat')).toBe(base + 1);
  });
});

describe('los interruptores', () => {
  test('apagar el mercado, el trueque y el chat cierra sus escrituras al momento; leer sigue funcionando', async () => {
    const cookie = await player();
    expect((await publish('features', { data: { market: false, trades: false, chat: false }, reason: 'Mantenimiento', password: admin.password })).statusCode).toBe(201);
    expect((await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: randomUUID(), price: 50 }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'market_disabled' });
    expect((await get(ctx.app, '/galaxy/api/market', { cookie })).statusCode).toBe(200);
    expect((await post(ctx.app, '/galaxy/api/trades', { username: 'alguien', give: randomUUID() }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'trades_disabled' });
    expect((await post(ctx.app, '/galaxy/api/chat/global/messages', { body: 'hola' }, { cookie })).json()).toEqual({ error: 'chat_disabled' });
    expect((await get(ctx.app, '/galaxy/api/chat/global', { cookie })).statusCode).toBe(200);
    expect((await publish('features', { data: { market: true, trades: true, chat: true }, reason: 'Vuelve', password: admin.password })).statusCode).toBe(201);
    expect((await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: randomUUID(), price: 50 }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).not.toEqual({ error: 'market_disabled' });
    expect((await post(ctx.app, '/galaxy/api/trades', { username: 'alguien', give: randomUUID() }, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).not.toEqual({ error: 'trades_disabled' });
    expect((await post(ctx.app, '/galaxy/api/chat/global/messages', { body: 'hola' }, { cookie })).json()).toEqual({ error: 'chat_level' });
  });
});
