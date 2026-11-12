import { PROBE_TEST, type Profile } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { grantCosmetics } from '../../src/cosmetics/service';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The probes on a profile (plan «banda sonora, skins, perfil y entorno», part D): the owner chooses up to three of
// their probes to show; anyone sees them, and below them every probe the owner has with its level and skin.

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('prb');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const answers = PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never));
  expect((await post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie })).statusCode).toBe(200);
  return { cookie, id: (res.json() as { id: string }).id, username };
}
const profile = async (viewer: string, username: string) => (await get(ctx.app, `/galaxy/api/profiles/${username}`, { cookie: viewer })).json() as Profile;
const choose = (cookie: string, probes: unknown) => put(ctx.app, '/galaxy/api/profile/probes', { probes }, { cookie });

test('sin elegir nada, el perfil enseña sus sondas con su nivel y el escaparate vacío', async () => {
  const p = await player();
  expect((await profile(p.cookie, p.username)).probes).toEqual({ showcase: [], all: [{ id: 'lumen', level: 1, skin: null, variant: null }] });
});

test('elige su escaparate y cualquiera lo ve, con la skin que lleva cada sonda', async () => {
  const p = await player();
  const other = await player();
  await grantCosmetics(ctx.db, p.id, { skin: 'skin-lumen-coral' });
  expect((await put(ctx.app, '/galaxy/api/hangar/probes/lumen/skin', { skin: 'skin-lumen-coral' }, { cookie: p.cookie })).statusCode).toBe(200);
  const res = await choose(p.cookie, ['lumen']);
  expect(res.statusCode, res.body).toBe(200);
  expect((await profile(other.cookie, p.username)).probes!.showcase).toEqual([{ id: 'lumen', level: 1, skin: 'skin-lumen-coral', variant: null }]);
  // And emptied again.
  expect((await choose(p.cookie, [])).statusCode).toBe(200);
  expect((await profile(other.cookie, p.username)).probes!.showcase).toEqual([]);
});

test('solo sondas suyas (409), tres como mucho y sin repetir (400)', async () => {
  const p = await player();
  const locked = await choose(p.cookie, ['bastion']);
  expect(locked.statusCode).toBe(409);
  expect(locked.json()).toEqual({ error: 'probe_locked' });
  expect((await choose(p.cookie, ['lumen', 'lumen'])).statusCode).toBe(400);
  expect((await choose(p.cookie, ['lumen', 'bastion', 'spark', 'prism'])).statusCode).toBe(400);
  expect((await profile(p.cookie, p.username)).probes!.showcase).toEqual([]);
});
