import type { AccountSettings, SettingsView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The settings on the account (plan «ajustes en la cuenta»): what a player chose in Ajustes — sound, image,
// accessibility, game — kept with the account, so every device shows the same. Nothing until the first save; each
// field checked on the way in, unknown ones dropped; each account sees only its own.
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('ajs');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), username };
}
const read = async (cookie: string) => (await get(ctx.app, '/galaxy/api/settings', { cookie })).json() as SettingsView;

const mine: AccountSettings = {
  v: 1,
  scannerPro: false,
  motion: 'reduced',
  colorVision: 'deutan',
  music: 0.25,
  sfx: 0.6,
  muted: false,
  ui: true,
  cursor: true,
  cursorSize: 'large',
  cursorColor: '#6fe3ff',
  manualAim: true,
  notesSeen: '1.3',
};

test('sin guardar no hay ajustes; guardados, se leen igual desde cualquier sesión', async () => {
  const p = await player();
  expect(await read(p.cookie)).toEqual({ settings: null, updatedAt: null });
  const saved = await put(ctx.app, '/galaxy/api/settings', mine, { cookie: p.cookie });
  expect(saved.statusCode).toBe(200);
  expect((saved.json() as SettingsView).settings).toEqual(mine);
  // Another device: a new session of the same account.
  const again = sessionCookie(await post(ctx.app, '/galaxy/api/auth/login', { username: p.username, password: 'una-clave-larga' }));
  const view = await read(again);
  expect(view.settings).toEqual(mine);
  expect(Date.parse(view.updatedAt!)).not.toBeNaN();
  // A later save replaces the whole set.
  await put(ctx.app, '/galaxy/api/settings', { v: 1, music: 0.9 }, { cookie: again });
  expect((await read(p.cookie)).settings).toEqual({ v: 1, music: 0.9 });
});

test('los valores fuera de rango no se guardan; los campos que no existen se descartan', async () => {
  const p = await player();
  for (const bad of [{ v: 1, music: 2 }, { v: 1, motion: 'rapido' }, { v: 1, colorVision: 'x' }, { v: 1, cursorColor: 'red' }, { v: 1, cursorSize: 'enorme' }, { v: 2 }, { v: 1, notesSeen: 'beta' }]) {
    const res = await put(ctx.app, '/galaxy/api/settings', bad, { cookie: p.cookie });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_input' });
  }
  expect((await read(p.cookie)).settings).toBeNull();
  await put(ctx.app, '/galaxy/api/settings', { v: 1, muted: true, secreto: 'no' }, { cookie: p.cookie });
  expect((await read(p.cookie)).settings).toEqual({ v: 1, muted: true });
});

test('cada cuenta ve solo los suyos, y sin sesión no hay nada', async () => {
  const [a, b] = [await player(), await player()];
  await put(ctx.app, '/galaxy/api/settings', { v: 1, colorVision: 'tritan' }, { cookie: a.cookie });
  expect((await read(b.cookie)).settings).toBeNull();
  expect((await get(ctx.app, '/galaxy/api/settings')).statusCode).toBe(401);
  expect((await put(ctx.app, '/galaxy/api/settings', { v: 1 })).statusCode).toBe(401);
});
