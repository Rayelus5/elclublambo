import { DEFAULT_CONTENT } from '@galaxy/sim';
import { type Gift, parseConfig, PROBE_TEST } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { inTransaction } from '../../src/db/tx';
import { getWallet } from '../../src/economy/wallet';
import { grantGifts } from '../../src/gifts/grant';
import { fixedConfig, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Gifts of every kind on the server (mail v2, 2026-11-16): one service gives resources, cosmetic pieces, galaxies,
// probes, XP and season points inside the caller's transaction, says what each gift did (given, already owned, not
// given) and makes the same galaxies for the same key.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('gif'), password: 'una-clave-larga' });
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie: sessionCookie(res) });
  return id;
}
const open = { id: 's-gifts', open: true };
const give = (account: string, gifts: Gift[], key: string, season = open) =>
  inTransaction(ctx.db, (trx) => grantGifts(trx, account, gifts, { key, reason: 'mail_gift', ref: { test: key }, actor: { id: null, label: 'test' }, season }));
const rewardSkin = parseConfig('cosmetics', {}).skins.find((s) => s.source === 'reward')!.id;

test('los recursos se juntan por moneda y se abonan', async () => {
  const id = await player();
  const before = await getWallet(ctx.db, id);
  const r = await give(id, [
    { kind: 'currency', currency: 'coins', amount: 100 },
    { kind: 'currency', currency: 'coins', amount: 50 },
    { kind: 'currency', currency: 'components', amount: 7 },
  ], `t:${id}:cur`);
  const after = await getWallet(ctx.db, id);
  expect(after.coins - before.coins).toBe(150);
  expect((after.components ?? 0) - (before.components ?? 0)).toBe(7);
  expect(r.items.every((i) => i.outcome === 'granted')).toBe(true);
});

test('una pieza se da una vez; la segunda dice que ya la tenía', async () => {
  const id = await player();
  const first = await give(id, [{ kind: 'cosmetic', piece: 'skin', id: rewardSkin }], `t:${id}:c1`);
  const second = await give(id, [{ kind: 'cosmetic', piece: 'skin', id: rewardSkin }], `t:${id}:c2`);
  expect(first.items[0]!.outcome).toBe('granted');
  expect(second.items[0]!.outcome).toBe('owned');
  const rows = await ctx.db.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', id).where('kind', '=', 'skin').execute();
  expect(rows.map((r) => r.value)).toContain(rewardSkin);
});

test('las galaxias se crean con su rareza y acabado, y la misma clave da las mismas', async () => {
  const a = await player();
  const b = await player();
  const gift: Gift = { kind: 'galaxy', tier: 'epic', finish: 'holo', trait: null, count: 2 };
  const ra = await give(a, [gift], 'mail:misma-clave');
  const rb = await give(b, [gift], 'mail:misma-clave');
  expect(ra.items[0]!.galaxies).toHaveLength(2);
  const rows = await ctx.db.selectFrom('galaxy.galaxies').select(['tier', 'finish', 'origin', 'dna']).where('owner_id', '=', a).orderBy('created_at').execute();
  expect(rows.slice(-2).every((r) => r.tier === 3 && r.finish === 'holo' && r.origin === 'grant')).toBe(true);
  // The same key and the same index give the same galaxies, whoever claims them.
  expect(rb.items[0]!.galaxies!.map((g) => g.name)).toEqual(ra.items[0]!.galaxies!.map((g) => g.name));
});

test('una galaxia imposible no se da y dice por qué', async () => {
  const id = await player();
  const r = await give(id, [{ kind: 'galaxy', tier: 'legendary', finish: 'normal', trait: { key: 'galaxy_type', value: 'no-es-un-tipo' }, count: 1 }], `t:${id}:imp`);
  expect(r.items[0]).toMatchObject({ outcome: 'skipped', why: 'galaxy_unreachable' });
});

test('una sonda se desbloquea una vez', async () => {
  const id = await player();
  const probe = DEFAULT_CONTENT.probes[1]!.id;
  const first = await give(id, [{ kind: 'probe', probe }], `t:${id}:p1`);
  const second = await give(id, [{ kind: 'probe', probe }], `t:${id}:p2`);
  expect([first.items[0]!.outcome, second.items[0]!.outcome]).toEqual(['granted', 'owned']);
  expect(await ctx.db.selectFrom('galaxy.probe_grants').select('probe').where('account_id', '=', id).execute()).toEqual([{ probe }]);
});

test('la experiencia se suma y los puntos van a la temporada abierta (y no a una cerrada)', async () => {
  const id = await player();
  const r = await give(id, [
    { kind: 'xp', amount: 300 },
    { kind: 'seasonPoints', amount: 40 },
  ], `t:${id}:xp`);
  expect(r.seasonTouched).toBe(true);
  const xp = await ctx.db.selectFrom('galaxy.account_xp').select('xp').where('account_id', '=', id).executeTakeFirst();
  expect(Number(xp?.xp)).toBeGreaterThanOrEqual(300);
  const pts = await ctx.db.selectFrom('galaxy.season_adjustments').select(['points', 'source', 'season']).where('account_id', '=', id).execute();
  expect(pts).toEqual([{ points: 40, source: 'mail', season: 's-gifts' }]);
  const closed = await give(id, [{ kind: 'seasonPoints', amount: 40 }, { kind: 'currency', currency: 'season:s-gifts', amount: 10 }], `t:${id}:xp2`, { id: 's-gifts', open: false });
  expect(closed.items.map((i) => i.outcome)).toEqual(['skipped', 'skipped']);
});
