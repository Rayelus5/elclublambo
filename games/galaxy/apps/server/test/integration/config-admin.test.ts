import { randomUUID } from 'node:crypto';
import { CONFIG_KEYS, type ConfigKey, PROBE_TEST, parseConfig } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ConfigService } from '../../src/config/service';
import { createAdminViaCli, get, post, randomIp, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The live config from the admin panel (GDD §16.3; M6b): every key with what is live (or its default), a draft checked
// against its schema with each issue at its path, publishing with a reason and the admin's password (an invalid draft
// is refused with its issues), and the switches that close the market, the swaps and the chat at once.
// The local DB is the user's and its live config is never published from tests: the app runs on an in-memory config
// service that keeps versions like the real one (merging onto what is live, validated by the registry schema).

function memoryConfig(): ConfigService {
  const store = new Map<ConfigKey, { version: number; data: unknown; createdAt: string; createdBy: string | null; note: string }[]>();
  const current = (key: ConfigKey) => store.get(key)?.at(-1)?.data ?? {};
  return {
    get: async (key) => parseConfig(key, current(key)),
    getVersioned: async (key) => ({ value: parseConfig(key, current(key)), version: store.get(key)?.at(-1)?.version ?? 0 }),
    versions: async (key) => [...(store.get(key) ?? [])],
    active: async () => [...store.entries()].map(([key, v]) => ({ key, version: v.at(-1)!.version, data: v.at(-1)!.data })),
    publish: async (key, data, who, reason) => {
      const merged = parseConfig(key, { ...(current(key) as object), ...(data as object) });
      const list = store.get(key) ?? [];
      const version = (list.at(-1)?.version ?? 0) + 1;
      list.push({ version, data: merged, createdAt: new Date().toISOString(), createdBy: who.id, note: reason });
      store.set(key, list);
      return { version };
    },
  } as ConfigService;
}

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
let admin: { cookie: string; password: string; username: string };
beforeAll(async () => {
  ctx = await testApp({ config: memoryConfig() });
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  admin = { cookie: sessionCookie(res), password, username };
});
afterAll(() => ctx.close());

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
    expect((await post(ctx.app, '/galaxy/api/chat/global/messages', { body: 'hola' }, { cookie })).json()).toEqual({ error: 'chat_level' });
  });
});
