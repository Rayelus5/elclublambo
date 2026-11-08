import { type ConfigKey, parseConfig } from '@galaxy/shared';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import { type ConfigService, createConfigService } from '../../src/config/service';
import { createAdminViaCli, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

let ctx: Awaited<ReturnType<typeof testApp>>;
let config: ConfigService;
const actor = { id: null, label: 'test' };

beforeAll(async () => {
  ctx = await testApp();
  config = createConfigService(ctx.db);
});
afterAll(() => ctx.close());

/** The local DB is the user's: every test leaves features/auth exactly at the schema defaults. */
afterEach(async () => {
  const fresh = createConfigService(ctx.db);
  for (const key of ['features', 'auth'] as ConfigKey[]) {
    if (JSON.stringify(await fresh.get(key)) !== JSON.stringify(parseConfig(key, {}))) {
      // Publishing merges onto the active value: restore with the full default object.
      await fresh.publish(key, parseConfig(key, {}), actor, 'restaurar tras un test');
    }
  }
});

/** Each admin session's password: publishing asks for it (M6b). */
const passwords = new Map<string, string>();

async function adminSession(): Promise<string> {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  passwords.set(sessionCookie(res), password);
  return sessionCookie(res);
}

async function playerSession(): Promise<string> {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('jug'), password: 'una-clave-larga' });
  expect(res.statusCode).toBe(201);
  return sessionCookie(res);
}

async function lastAudit() {
  return ctx.db.selectFrom('galaxy.admin_audit_log').selectAll().orderBy('id', 'desc').executeTakeFirstOrThrow();
}

test('el servicio lee la versión activa ya validada', async () => {
  expect(await config.get('features')).toEqual({ registrationOpen: true, maintenance: false, gacha: true, runs: true, market: true, trades: true, chat: true });
  expect((await config.get('auth')).sessionDays).toBe(30);
});

test('publicar valida, versiona y audita con el antes y el después', async () => {
  const before = await config.versions('auth');
  await expect(config.publish('auth', { sessionDays: 0 }, actor, 'prueba')).rejects.toThrow();
  expect(await config.versions('auth')).toHaveLength(before.length);

  const { version } = await config.publish('auth', { sessionDays: 31 }, actor, 'prueba');
  expect(version).toBe(before.at(-1)!.version + 1);
  const versions = await config.versions('auth');
  expect(versions.at(-1)).toMatchObject({ version, note: 'prueba', createdBy: null });
  expect((versions.at(-1)!.data as { sessionDays: number }).sessionDays).toBe(31);
  expect(await config.get('auth')).toMatchObject({ sessionDays: 31, adminSessionHours: 12 });
  expect(await lastAudit()).toMatchObject({
    action: 'config.published',
    target_type: 'config',
    target_id: 'auth',
    reason: 'prueba',
    actor_label: 'test',
  });
  expect((await lastAudit()).before).toMatchObject({ sessionDays: 30 });
  expect((await lastAudit()).after).toMatchObject({ sessionDays: 31 });
});

test('publicar un solo campo conserva los demás: cerrar el registro y luego tocar el mantenimiento no lo reabre (revisión final I3)', async () => {
  await config.publish('features', { registrationOpen: false }, actor, 'cerrar registro');
  await config.publish('features', { maintenance: true }, actor, 'mantenimiento');
  expect(await config.get('features')).toEqual({ registrationOpen: false, maintenance: true, gacha: true, runs: true, market: true, trades: true, chat: true });
  await config.publish('features', { maintenance: false }, actor, 'fin');
  expect(await config.get('features')).toEqual({ registrationOpen: false, maintenance: false, gacha: true, runs: true, market: true, trades: true, chat: true });
  await config.publish('auth', { sessionDays: 31 }, actor, 'sesiones');
  expect((await config.get('auth')).registerPerIpHour).toBe(5);
  await config.publish('auth', { registerPerIpHour: 9 }, actor, 'límite');
  expect(await config.get('auth')).toMatchObject({ sessionDays: 31, registerPerIpHour: 9 });
});

test('una clave mal escrita en la API → 400 config_invalid y no se publica nada', async () => {
  const admin = await adminSession();
  const before = (await config.versions('features')).length;
  const res = await post(ctx.app, '/galaxy/api/admin/config/features', { data: { maintenance: false, regstrationOpen: true }, reason: 'errata', password: passwords.get(admin) }, { cookie: admin });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ error: 'config_invalid' });
  expect(await config.versions('features')).toHaveLength(before);
});

test('dos publicaciones a la vez dan dos versiones seguidas, sin choque', async () => {
  const start = (await config.versions('features')).at(-1)!.version;
  const [a, b] = await Promise.all([
    createConfigService(ctx.db).publish('features', { registrationOpen: true }, actor, 'a'),
    createConfigService(ctx.db).publish('features', { registrationOpen: true }, actor, 'b'),
  ]);
  expect([a.version, b.version].sort()).toEqual([start + 1, start + 2]);
});

test('la caché dura 10 s: otro proceso publica y este lo ve al caducar', async () => {
  let t = 1_000_000;
  const cached = createConfigService(ctx.db, { now: () => t });
  expect((await cached.get('features')).registrationOpen).toBe(true);
  await createConfigService(ctx.db).publish('features', { registrationOpen: false }, actor, 'otro proceso');
  t += 9_999;
  expect((await cached.get('features')).registrationOpen).toBe(true);
  t += 2;
  expect((await cached.get('features')).registrationOpen).toBe(false);
});

test('rutas de admin: sin sesión 401, jugador 403, admin con TOTP 200', async () => {
  expect((await get(ctx.app, '/galaxy/api/admin/config')).statusCode).toBe(401);
  const player = await playerSession();
  expect((await get(ctx.app, '/galaxy/api/admin/config', { cookie: player })).statusCode).toBe(403);
  expect((await post(ctx.app, '/galaxy/api/admin/config/features', { data: {}, reason: 'jugador' }, { cookie: player })).statusCode).toBe(403);
  const admin = await adminSession();
  const list = await get(ctx.app, '/galaxy/api/admin/config', { cookie: admin });
  expect(list.statusCode).toBe(200);
  expect(list.json()).toEqual(
    expect.arrayContaining([
      // Earlier publishes store the full parsed value (with every flag added since), so only the seeded ones are named.
      expect.objectContaining({ key: 'features', data: expect.objectContaining({ registrationOpen: true, maintenance: false, gacha: true }) }),
      expect.objectContaining({ key: 'auth' }),
    ]),
  );
  const versions = await get(ctx.app, '/galaxy/api/admin/config/auth/versions', { cookie: admin });
  expect(versions.statusCode).toBe(200);
  expect(versions.json()[0]).toMatchObject({ version: 1, note: 'versión inicial' });
});

test('publicar por la API: clave desconocida 404, datos inválidos 400 config_invalid, motivo corto 400', async () => {
  const admin = await adminSession();
  const url = '/galaxy/api/admin/config/features';
  expect((await post(ctx.app, '/galaxy/api/admin/config/nada', { data: {}, reason: 'prueba', password: passwords.get(admin) }, { cookie: admin })).json()).toEqual({
    error: 'not_found',
  });
  const bad = await post(ctx.app, url, { data: { maintenance: 'sí' }, reason: 'prueba', password: passwords.get(admin) }, { cookie: admin });
  expect(bad.statusCode).toBe(400);
  expect(bad.json()).toMatchObject({ error: 'config_invalid' });
  expect((await post(ctx.app, url, { data: {}, reason: 'no', password: passwords.get(admin) }, { cookie: admin })).json()).toEqual({ error: 'invalid_input' });
  const ok = await post(ctx.app, url, { data: { registrationOpen: true }, reason: 'prueba por la API', password: passwords.get(admin) }, { cookie: admin });
  expect(ok.statusCode).toBe(201);
  expect(ok.json().version).toBeGreaterThan(1);
  const audit = await lastAudit();
  expect(audit).toMatchObject({ action: 'config.published', target_id: 'features', reason: 'prueba por la API' });
  expect(audit.actor_id).not.toBeNull();
});

test('mantenimiento: jugadores 503, los admins siguen entrando y lo apagan (Review Focus 5)', async () => {
  const player = await playerSession();
  const admin = await adminSession();
  const on = await post(ctx.app, '/galaxy/api/admin/config/features', { data: { maintenance: true }, reason: 'mantenimiento', password: passwords.get(admin) }, { cookie: admin });
  expect(on.statusCode).toBe(201);

  const reg = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('mant'), password: 'una-clave-larga' });
  expect(reg.statusCode).toBe(503);
  expect(reg.json()).toEqual({ error: 'maintenance' });
  expect((await get(ctx.app, '/galaxy/api/auth/me', { cookie: player })).statusCode).toBe(200);
  expect((await get(ctx.app, '/galaxy/api/health')).statusCode).toBe(200);

  // A second admin can still log in (login + totp are allowed) and switch maintenance off.
  const admin2 = await adminSession();
  const off = await post(ctx.app, '/galaxy/api/admin/config/features', { data: { maintenance: false }, reason: 'fin', password: passwords.get(admin2) }, { cookie: admin2 });
  expect(off.statusCode).toBe(201);
  expect((await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('mant'), password: 'una-clave-larga' })).statusCode).toBe(201);
});

test('mantenimiento: una ruta codificada (/galaxy/%61pi/…) no se salta el bloqueo (revisión final I1)', async () => {
  await config.publish('features', { maintenance: true }, actor, 'mantenimiento');
  const app = await testApp();
  try {
    for (const url of ['/galaxy/%61pi/auth/register', '/galaxy/api/auth/%72egister']) {
      const res = await post(app.app, url, { username: uniqueName('cod'), password: 'una-clave-larga' });
      expect(res.statusCode, url).toBe(503);
      expect(res.json()).toEqual({ error: 'maintenance' });
    }
  } finally {
    await app.close();
  }
});

test('registro cerrado → 403 registration_closed; el login sigue funcionando', async () => {
  await config.publish('features', { registrationOpen: false }, actor, 'cerrar registro');
  const app = await testApp();
  try {
    const res = await post(app.app, '/galaxy/api/auth/register', { username: uniqueName('cerr'), password: 'una-clave-larga' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'registration_closed' });
  } finally {
    await app.close();
  }
});

test('un banner de evento sin su destacada no se publica: 400 config_invalid y nada cambia (revisión final M2b; M7e-1)', async () => {
  // Since the events milestone (M7e-1) event scanners are published, but one without its featured trait is refused.
  const admin = await adminSession();
  const versions = createConfigService(ctx.db);
  const before = (await versions.versions('gacha')).length;
  const event = {
    id: 'nova',
    kind: 'event',
    name: 'Lluvia de cometas',
    pityGroup: 'event-nova',
    currency: 'signal:nova',
  };
  const standard = { id: 'deep-scan', kind: 'standard', name: 'Escáner profundo', pityGroup: 'standard', currency: 'signal' };
  const res = await post(ctx.app, '/galaxy/api/admin/config/gacha', { data: { banners: [standard, event] }, reason: 'evento de prueba', password: passwords.get(admin) }, { cookie: admin });
  expect(res.statusCode).toBe(400);
  expect(res.json()).toMatchObject({ error: 'config_invalid' });
  expect((await versions.versions('gacha')).length).toBe(before);
});
