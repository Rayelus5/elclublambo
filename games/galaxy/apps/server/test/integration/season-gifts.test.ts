import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { type Gift, parseConfig, PROBE_TEST, type SeasonView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { invalidateLeaderboard } from '../../src/social/leaderboard';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Season prizes of every kind (plan «temporadas como fichas», PR 4, 2026-11-22): a step, an item and a closing prize
// pay their gifts once, under the guard each already had (the step's claim row, the item's counter, the result's
// claimed_at); the close pays by place to those who can win prizes for their place; and a season with big gifts only
// a superadmin schedules. Every season here has ids and windows of its own, so no other file meets them.

const galaxy: Gift = { kind: 'galaxy', tier: 'rare', finish: 'normal', trait: null, count: 1 };
const probe: Gift = { kind: 'probe', probe: 'bastion' };
const frame: Gift = { kind: 'cosmetic', piece: 'frame', id: 'nebula' };

type App = Awaited<ReturnType<typeof testApp>>;

async function player(app: App, prefix: string) {
  const res = await post(app.app, '/galaxy/api/auth/register', { username: uniqueName(prefix), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const accountId = (res.json() as { id: string }).id;
  await post(app.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, accountId };
}

async function granted(app: App, accountId: string) {
  const galaxies = await app.db.selectFrom('galaxy.galaxies').select(['id', 'seed', 'tier']).where('owner_id', '=', accountId).where('origin', '=', 'grant').execute();
  const probes = await app.db.selectFrom('galaxy.probe_grants').select('probe').where('account_id', '=', accountId).execute();
  const frames = await app.db.selectFrom('galaxy.cosmetics').select('value').where('account_id', '=', accountId).where('kind', '=', 'frame').execute();
  return { galaxies, probes: probes.map((p) => p.probe), frames: frames.map((f) => f.value) };
}

describe('la ruta y la tienda', () => {
  // A random three-day window long past, with the app's clock inside it (as season-route.test.ts).
  const season = `tg-${randomBytes(4).toString('hex')}`;
  const start = Date.UTC(1990, 0, 1) + randomInt(30 * 365 * 24 * 60) * 60_000;
  const clock = new Date(start + 86_400_000);
  let app: App;
  beforeAll(async () => {
    app = await testApp({
      now: () => clock,
      config: fixedConfig({
        season: { id: season, name: 'Prueba', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 3 * 86_400_000).toISOString() },
        seasonRoute: {
          steps: [{ at: 100, reward: { shards: 50 }, gifts: [galaxy, probe] }],
          shop: [{ id: 'gx', name: 'Galaxia', price: 10, limit: 2, gifts: [galaxy] }],
        },
      }),
    });
  });
  afterAll(() => app.close());

  test('un escalón da sus regalos una vez y cada compra los suyos, con galaxias distintas', async () => {
    const { cookie, accountId } = await player(app, 'sgr');
    await app.db.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season, points: 300 }).execute();
    invalidateLeaderboard();
    const before = await granted(app, accountId);

    const key = randomUUID();
    const claim = await post(app.app, '/galaxy/api/season/route/100/claim', undefined, { cookie, headers: { 'idempotency-key': key } });
    expect(claim.statusCode, claim.body).toBe(200);
    expect((claim.json() as SeasonView).steps[0]).toMatchObject({ at: 100, claimed: true, gifts: [galaxy, probe] });
    // The same request again is the same answer, not a second payment; another request is refused.
    await post(app.app, '/galaxy/api/season/route/100/claim', undefined, { cookie, headers: { 'idempotency-key': key } });
    expect((await post(app.app, '/galaxy/api/season/route/100/claim', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'already_claimed' });
    const afterClaim = await granted(app, accountId);
    expect(afterClaim.galaxies.length - before.galaxies.length).toBe(1);
    expect(afterClaim.probes).toContain('bastion');

    for (let i = 0; i < 2; i++) {
      const buy = await post(app.app, '/galaxy/api/season/shop/gx/buy', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } });
      expect(buy.statusCode, buy.body).toBe(200);
    }
    expect((await post(app.app, '/galaxy/api/season/shop/gx/buy', undefined, { cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'season_item_sold_out' });
    const afterShop = await granted(app, accountId);
    const bought = afterShop.galaxies.filter((g) => !afterClaim.galaxies.some((x) => x.id === g.id));
    expect(bought).toHaveLength(2);
    expect(new Set(bought.map((g) => g.seed)).size).toBe(2);
    expect(bought.every((g) => g.tier === 2)).toBe(true);
  });
});

describe('el cierre por puestos', () => {
  // A random past minute with no runs, so only the points given here rank (as season-close.test.ts).
  const season = `tc-${randomBytes(4).toString('hex')}`;
  const start = Date.UTC(2025, 0, 1) + Math.floor(Math.random() * 300 * 86_400_000);
  let app: App;
  beforeAll(async () => {
    const closing = { ...parseConfig('seasonRoute', {}).closing, podiumSize: 1, podiumGifts: [probe], places: [{ from: 1, to: 1, gifts: [galaxy] }, { from: 2, to: 3, gifts: [frame] }] };
    app = await testApp({
      config: fixedConfig({ season: { id: season, name: 'Cierre con puestos', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 60_000).toISOString() }, seasonRoute: { closing } }),
    });
  });
  afterAll(() => app.close());

  test('quien no puede ganar premios conserva su puesto y el suyo pasa al siguiente; cada uno recoge sus regalos una vez', async () => {
    const admin = await player(app, 'sca');
    const [first, second, third, fourth] = [await player(app, 'sc1'), await player(app, 'sc2'), await player(app, 'sc3'), await player(app, 'sc4')];
    await app.db.updateTable('galaxy.accounts').set({ prize_eligible: false }).where('id', '=', admin.accountId).execute();
    for (const [p, points] of [[admin, 9000], [first, 7000], [second, 3000], [third, 600], [fourth, 100]] as const) {
      await app.db.insertInto('galaxy.season_adjustments').values({ account_id: p.accountId, season, points }).execute();
    }

    const view = (await get(app.app, '/galaxy/api/season', { cookie: first.cookie })).json() as SeasonView;
    expect(view.closing).toMatchObject({ season, rank: 2, podium: true });
    // Its tier's prize, the podium's (a probe) and the first place's (a galaxy).
    expect(view.closing!.rewards.map((r) => r.gifts)).toEqual([[], [probe], [galaxy]]);
    expect(view.closing!.rewards[2]!.place).toEqual({ from: 1, to: 1 });

    const results = await app.db.selectFrom('galaxy.season_results').select(['account_id', 'rank', 'podium', 'rewards']).where('season', '=', season).orderBy('rank').execute();
    const of = (id: string) => results.find((r) => r.account_id === id)!;
    expect(of(admin.accountId)).toMatchObject({ rank: 1, podium: false });
    expect((of(admin.accountId).rewards as { place?: unknown }[]).some((r) => r.place)).toBe(false);
    expect((of(third.accountId).rewards as { gifts: Gift[] }[]).flatMap((r) => r.gifts)).toEqual([frame]);
    expect((of(fourth.accountId).rewards as { gifts: Gift[] }[]).flatMap((r) => r.gifts)).toEqual([]);

    const before = await granted(app, first.accountId);
    const claim = await post(app.app, `/galaxy/api/season/results/${season}/claim`, undefined, { cookie: first.cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(claim.statusCode, claim.body).toBe(200);
    expect((await post(app.app, `/galaxy/api/season/results/${season}/claim`, undefined, { cookie: first.cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'already_claimed' });
    const after = await granted(app, first.accountId);
    expect(after.galaxies.length - before.galaxies.length).toBe(1);
    expect(after.probes).toContain('bastion');

    await post(app.app, `/galaxy/api/season/results/${season}/claim`, undefined, { cookie: second.cookie, headers: { 'idempotency-key': randomUUID() } });
    expect((await granted(app, second.accountId)).frames).toContain('nebula');
  });
});

describe('programar una temporada con regalos grandes', () => {
  const tag = randomBytes(3).toString('hex');
  const ID = `tbig-${tag}`;
  const record = {
    id: ID,
    name: 'Temporada con sonda',
    startsAt: '2096-01-31T23:00:00.000Z',
    endsAt: '2096-02-28T23:00:00.000Z',
    rules: { anomaly: null },
    route: { steps: [{ at: 100, gifts: [probe] }], shop: [] },
  };
  let app: App;
  const login = async (role: 'admin' | 'superadmin') => {
    const { username, password, totpSecret } = await createAdminViaCli(app.db, role);
    const first = await post(app.app, '/galaxy/api/auth/login', { username, password });
    const res = await post(app.app, '/galaxy/api/auth/totp', { challenge: first.json().challenge, code: totpNow(totpSecret) });
    return { cookie: sessionCookie(res), password };
  };
  beforeAll(async () => {
    app = await testApp({ seasons: true });
  });
  afterAll(async () => {
    await app.db.updateTable('galaxy.seasons').set({ state: 'draft' }).where('id', '=', ID).execute();
    await app.db.deleteFrom('galaxy.seasons').where('id', '=', ID).execute();
    await app.close();
  });

  test('un admin la guarda y ve por qué es grande, pero solo un superadmin la programa', async () => {
    const admin = await login('admin');
    const checked = (await post(app.app, '/galaxy/api/admin/seasons/validate', { record }, { cookie: admin.cookie })).json() as { ok: boolean; big: { path: string; reasons: string[] }[] };
    expect(checked.ok).toBe(true);
    expect(checked.big).toEqual([{ path: 'route.steps.0', reasons: ['probe'] }]);
    const saved = await post(app.app, '/galaxy/api/admin/seasons', { record, reason: 'Con una sonda' }, { cookie: admin.cookie });
    expect(saved.statusCode, saved.body).toBe(201);

    const refused = await post(app.app, `/galaxy/api/admin/seasons/${ID}/schedule`, { reason: 'A su hora', password: admin.password }, { cookie: admin.cookie });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'season_needs_superadmin', reasons: ['probe'] });

    const owner = await login('superadmin');
    const scheduled = await post(app.app, `/galaxy/api/admin/seasons/${ID}/schedule`, { reason: 'A su hora', password: owner.password }, { cookie: owner.cookie });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
  });

  test('un regalo que no existe no deja guardarla', async () => {
    const admin = await login('admin');
    const bad = { ...record, id: `${ID}-x`.slice(0, 32), route: { steps: [{ at: 100, gifts: [{ kind: 'probe', probe: 'no-existe' }] }], shop: [] } };
    const res = await post(app.app, '/galaxy/api/admin/seasons', { record: bad, reason: 'Con una sonda que no hay' }, { cookie: admin.cookie });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { issues: { path: string; message: string }[] }).issues).toEqual([{ path: 'route.steps.0.gifts.0', message: 'gift_probe_unknown' }]);
  });
});
