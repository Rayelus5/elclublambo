import { randomUUID } from 'node:crypto';
import { type BackdropView, type CosmeticsView, DEFAULT_ACHIEVEMENTS, DEFAULT_CATALOG_REWARDS, PROBE_TEST } from '@galaxy/shared';
import { DEFAULT_CONTENT, SIM_VERSION, encodeLog, toBase64 } from '@galaxy/sim';
import { sql } from 'kysely';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { backfillCosmetics } from '../../src/cosmetics/backfill';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// «Personalizar» (Nov plan C2): avatars, frames, titles and the banner — what a player has, wears and may choose;
// Núcleo portraits on the first win, and the backfill for who earned pieces before they existed.
let clock = new Date(Date.now() - 3 * 3_600_000);
let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('cos');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen')) }, { cookie });
  const id = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;
  return { cookie, id };
}
const view = async (cookie: string) => (await get(ctx.app, '/galaxy/api/profile/cosmetics', { cookie })).json() as CosmeticsView;
const INPUTS = toBase64(encodeLog({ probes: 1, events: [1, 0, 0, 127, 0, -1, 300, 0, 0, 0, 0, -1] }));

async function runWithBoss(cookie: string) {
  const start = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });
  clock = new Date(clock.getTime() + 8 * 60_000);
  const body = { outcome: 'died', ticks: 7 * 3600, depth: 2, kills: 400, bossKills: 1, level: 9, loot: [{ coins: 10, dust: 3 }, { coins: 4, dust: 1 }], hash: '0123456789abcdef', inputs: INPUTS };
  expect((await post(ctx.app, `/galaxy/api/runs/${start.json().id}/finish`, body, { cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
}

test('sin nada, lleva su firma y puede ponerse cualquier avatar de serie, pero no uno que no tiene', async () => {
  const { cookie } = await player();
  const v = await view(cookie);
  expect(v.equipped).toEqual({ avatar: null, frame: null, title: null, banner: null, backdrop: [] });
  expect(v.owned).toEqual({ avatars: [], frames: [], titles: [] });
  expect(v.catalog.avatars.filter((a) => a.source === 'default')).toHaveLength(12);
  const worn = await put(ctx.app, '/galaxy/api/profile/cosmetics', { avatar: 'crew-cat' }, { cookie });
  expect(worn.statusCode).toBe(200);
  expect((worn.json() as CosmeticsView).equipped.avatar).toBe('crew-cat');
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { avatar: 'portrait-hive' }, { cookie })).json()).toMatchObject({ error: 'cosmetic_locked' });
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { avatar: 'shop-void-knight' }, { cookie })).json()).toMatchObject({ error: 'cosmetic_locked' });
  // Only the fields sent change; null takes a piece off.
  expect(((await put(ctx.app, '/galaxy/api/profile/cosmetics', { title: null }, { cookie })).json() as CosmeticsView).equipped.avatar).toBe('crew-cat');
  expect(((await put(ctx.app, '/galaxy/api/profile/cosmetics', { avatar: null }, { cookie })).json() as CosmeticsView).equipped.avatar).toBeNull();
});

test('un logro da su avatar y vencer al Núcleo da su retrato, una vez', async () => {
  const { cookie } = await player();
  await runWithBoss(cookie);
  const v = await view(cookie);
  expect(v.owned.avatars).toContain('portrait-hive');
  await post(ctx.app, '/galaxy/api/achievements/a-first-run/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
  expect((await view(cookie)).owned.avatars).toEqual(expect.arrayContaining(['portrait-hive', 'probe-lumen']));
  await runWithBoss(cookie);
  expect((await view(cookie)).owned.avatars.filter((a) => a === 'portrait-hive')).toHaveLength(1);
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { avatar: 'portrait-hive' }, { cookie })).statusCode).toBe(200);
});

test('el banner es una galaxia suya; si deja de serlo, deja de verse', async () => {
  const me = await player();
  const other = await player();
  const pull = await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 1, pay: 'signal' }, { cookie: me.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(pull.statusCode).toBe(200);
  const galaxy = (pull.json() as { pulls: { id: string }[] }).pulls[0]!.id;
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { banner: galaxy }, { cookie: other.cookie })).json()).toMatchObject({ error: 'cosmetic_locked' });
  expect(((await put(ctx.app, '/galaxy/api/profile/cosmetics', { banner: galaxy }, { cookie: me.cookie })).json() as CosmeticsView).equipped.banner).toBe(galaxy);
  await ctx.db.updateTable('galaxy.galaxies').set({ owner_id: other.id }).where('id', '=', galaxy).execute();
  expect((await view(me.cookie)).equipped.banner).toBeNull();
});

test('el fondo del menú: hasta 12 galaxias suyas y que se vean bien; las que deja de tener desaparecen (plan «escáner pro», parte E)', async () => {
  const me = await player();
  const other = await player();
  const pull = await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 10, pay: 'signal' }, { cookie: me.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(pull.statusCode).toBe(200);
  const ids = (pull.json() as { pulls: { id: string }[] }).pulls.map((p) => p.id);
  // Fit for the sky: no Antimatter palette, no Anomaly (they would look like a broken screen).
  await ctx.db.updateTable('galaxy.galaxies').set({ traits: sql`traits || '{"palette":"nebula","phenomenon":"none"}'::jsonb` }).where('id', 'in', ids).execute();
  const chosen = ids.slice(0, 3);
  const saved = await put(ctx.app, '/galaxy/api/profile/cosmetics', { backdrop: chosen }, { cookie: me.cookie });
  expect(saved.statusCode).toBe(200);
  expect([...(saved.json() as CosmeticsView).equipped.backdrop].sort()).toEqual([...chosen].sort());
  const sky = (await get(ctx.app, '/galaxy/api/profile/backdrop', { cookie: me.cookie })).json() as BackdropView;
  expect(sky.chosen).toBe(true);
  expect(sky.galaxies.map((g) => g.id).sort()).toEqual([...chosen].sort());
  expect(sky.galaxies[0]).toMatchObject({ seed: expect.stringMatching(/^\d+$/), traits: expect.any(Object) });
  // Only one's own, at most 12, never twice, and fit for the sky.
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { backdrop: chosen }, { cookie: other.cookie })).json()).toMatchObject({ error: 'cosmetic_locked' });
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { backdrop: Array.from({ length: 13 }, () => randomUUID()) }, { cookie: me.cookie })).statusCode).toBe(400);
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { backdrop: [chosen[0], chosen[0]] }, { cookie: me.cookie })).statusCode).toBe(400);
  await ctx.db.updateTable('galaxy.galaxies').set({ traits: sql`traits || '{"palette":"antimatter"}'::jsonb` }).where('id', '=', ids[5]!).execute();
  expect((await put(ctx.app, '/galaxy/api/profile/cosmetics', { backdrop: [ids[5]] }, { cookie: me.cookie })).json()).toMatchObject({ error: 'backdrop_ineligible' });
  // Given away: it leaves the sky.
  await ctx.db.updateTable('galaxy.galaxies').set({ owner_id: other.id }).where('id', '=', chosen[0]!).execute();
  expect((await view(me.cookie)).equipped.backdrop).not.toContain(chosen[0]);
  expect(((await get(ctx.app, '/galaxy/api/profile/backdrop', { cookie: me.cookie })).json() as BackdropView).galaxies.map((g) => g.id)).not.toContain(chosen[0]);
  // None chosen: the six rarest that fit.
  await put(ctx.app, '/galaxy/api/profile/cosmetics', { backdrop: [] }, { cookie: me.cookie });
  const fallback = (await get(ctx.app, '/galaxy/api/profile/backdrop', { cookie: me.cookie })).json() as BackdropView;
  expect(fallback.chosen).toBe(false);
  expect(fallback.galaxies.length).toBe(6);
  expect(fallback.galaxies.map((g) => g.id)).not.toContain(ids[5]);
});

test('el relleno da con carácter retroactivo los retratos y lo de los logros ya cobrados, y se puede repetir', async () => {
  const { cookie, id } = await player();
  await runWithBoss(cookie);
  await post(ctx.app, '/galaxy/api/achievements/a-first-run/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
  // As if they were earned before the pieces existed.
  await ctx.db.deleteFrom('galaxy.cosmetics').where('account_id', '=', id).where('kind', '=', 'avatar').execute();
  const configs = { content: DEFAULT_CONTENT, achievements: DEFAULT_ACHIEVEMENTS, catalog: DEFAULT_CATALOG_REWARDS, route: [], season: 'season-x' };
  await backfillCosmetics(ctx.db, configs);
  await backfillCosmetics(ctx.db, configs);
  const avatars = (await view(cookie)).owned.avatars;
  expect(avatars.filter((a) => a === 'portrait-hive')).toHaveLength(1);
  expect(avatars).toContain('probe-lumen');
});
