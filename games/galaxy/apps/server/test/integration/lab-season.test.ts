import { randomBytes, randomUUID } from 'node:crypto';
import type { LabView, RedshiftView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { loadoutSnapshot } from '../../src/runs/service';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// The seasonal core of the Laboratorio (shop and lab plan, F2a): a second tree, renewed every season. Its levels are
// kept by season id, so a new season starts it empty, and between seasons it gives nothing and sells nothing. Buying a
// seasonal level names its season: a stale view (another season) gets 409 and pays nothing. Its stat bonus reaches the
// run's snapshot apart from the permanent one. A season of its own (random id, its own dates) keeps other tests out.

const SEASON_NODES = [
  { id: 'swarm-hunt', branch: 'probe', name: 'Cazador del enjambre', effect: { kind: 'stat', stat: 'damage' }, per: 0.03, max: 3, requires: null, cost: { dust: 30, components: 10 }, growth: 1.5 },
  { id: 'swarm-reap', branch: 'extraction', name: 'Cosecha', effect: { kind: 'payout', currency: 'dust' }, per: 0.04, max: 3, requires: 'swarm-hunt', cost: { dust: 40, components: 10 }, growth: 1.5 },
];
const id = (tag: string) => `t-${tag}-${randomBytes(3).toString('hex')}`;
// Near today: a session goes idle against the database's own clock, so the app's clock stays close to it.
const OPEN = new Date();
const DAY = 86_400_000;
const SEASON = { id: id('lab'), name: 'Temporada de prueba', startsAt: new Date(OPEN.getTime() - DAY).toISOString(), endsAt: new Date(OPEN.getTime() + 2 * DAY).toISOString() };
let clock = OPEN;

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock, config: fixedConfig({ lab: { season: SEASON_NODES }, season: SEASON }) });
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('lbs'), password: 'una-clave-larga' });
  const p = { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
  await credit(ctx.db, p.id, 'components', 600, 'test');
  await credit(ctx.db, p.id, 'coins', 500, 'test');
  await credit(ctx.db, p.id, 'dust', 1000, 'test');
  const repair = await post(ctx.app, '/galaxy/api/station/rooms/lab/upgrade', { level: 1 }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(repair.statusCode, repair.body).toBe(200);
  return p;
}
const lab = async (cookie: string, app = ctx.app) => (await get(app, '/galaxy/api/lab', { cookie })).json() as LabView;
const buy = (cookie: string, node: string, body: unknown, app = ctx.app) => post(app, `/galaxy/api/lab/nodes/${node}/upgrade`, body, { cookie, headers: { 'idempotency-key': randomUUID() } });

test('con la temporada abierta, la vista trae su árbol aparte del permanente, todo a cero', async () => {
  const { cookie } = await player();
  const v = await lab(cookie);
  expect(v.nodes).toHaveLength(16);
  expect(v.season).toMatchObject({ id: SEASON.id, name: SEASON.name, endsAt: SEASON.endsAt });
  expect(v.season!.nodes.map((n) => [n.id, n.level, n.unlocked])).toEqual([
    ['swarm-hunt', 0, true],
    ['swarm-reap', 0, false],
  ]);
  expect(v.season!.nodes[0]).toMatchObject({ now: 0, nextGain: 0.03, next: { dust: 30, components: 10 } });
});

test('un nivel de temporada se compra nombrando su temporada; su bonificación va aparte de la permanente', async () => {
  const { cookie, id: account } = await player();
  expect((await buy(cookie, 'hull', { level: 1 })).statusCode).toBe(200);
  expect((await buy(cookie, 'targeting', { level: 1 })).statusCode).toBe(200);
  const before = await getWallet(ctx.db, account);
  const res = await buy(cookie, 'swarm-hunt', { level: 1, season: SEASON.id });
  expect(res.statusCode, res.body).toBe(200);
  const v = res.json() as LabView;
  expect(v.season!.nodes[0]).toMatchObject({ level: 1, now: 0.03 });
  expect(v.season!.nodes[1]!.unlocked).toBe(true);
  expect(v.effects.bonuses.filter((b) => b.stat === 'damage').map((b) => b.value)).toEqual([0.02, 0.03]);
  const after = await getWallet(ctx.db, account);
  expect([before.dust - after.dust, before['components']! - after['components']!]).toEqual([30, 10]);
  // The run snapshots both bonuses at its start.
  const cfg = fixedConfig({ lab: { season: SEASON_NODES } });
  const [content, probes, labCfg, planetarium, redshift] = await Promise.all([cfg.get('content'), cfg.get('probes'), cfg.get('lab'), cfg.get('planetarium'), cfg.get('redshift')]);
  const snap = await loadoutSnapshot(ctx.db, account, 'lumen', 2, { content, probes, lab: labCfg, planetarium, redshift, labSeason: SEASON.id });
  expect(snap.bonuses.filter((b) => b.stat === 'damage').map((b) => b.value)).toEqual(expect.arrayContaining([0.02, 0.03]));
});

test('otra temporada, o ninguna, no compra niveles de temporada y no paga nada', async () => {
  const { cookie, id: account } = await player();
  const before = await getWallet(ctx.db, account);
  // Without its season, or naming another: the view was stale.
  expect((await buy(cookie, 'swarm-hunt', { level: 1 })).json()).toEqual({ error: 'lab_season_changed' });
  expect((await buy(cookie, 'swarm-hunt', { level: 1, season: 'otra-temporada' })).json()).toEqual({ error: 'lab_season_changed' });
  // After its end: no seasonal tree, nothing to buy.
  clock = new Date(OPEN.getTime() + 3 * DAY);
  try {
    expect((await lab(cookie)).season).toBeNull();
    expect((await buy(cookie, 'swarm-hunt', { level: 1, season: SEASON.id })).json()).toEqual({ error: 'lab_season_closed' });
  } finally {
    clock = OPEN;
  }
  expect(await getWallet(ctx.db, account)).toEqual(before);
});

test('una temporada nueva empieza su árbol de cero; la anterior queda guardada en su temporada', async () => {
  const { cookie } = await player();
  expect((await buy(cookie, 'swarm-hunt', { level: 1, season: SEASON.id })).statusCode).toBe(200);
  const next = { ...SEASON, id: id('lab2'), name: 'La siguiente' };
  const other = await testApp({ now: () => clock, config: fixedConfig({ lab: { season: SEASON_NODES }, season: next }) });
  try {
    const v = await lab(cookie, other.app);
    expect(v.season).toMatchObject({ id: next.id });
    expect(v.season!.nodes[0]!.level).toBe(0);
    expect(v.effects.bonuses.filter((b) => b.stat === 'damage')).toEqual([]);
  } finally {
    await other.close();
  }
  expect((await lab(cookie)).season!.nodes[0]!.level).toBe(1);
});

test('el prestigio solo cuenta los niveles de nodos permanentes que existen', async () => {
  const { cookie, id: account } = await player();
  expect((await buy(cookie, 'hull', { level: 1 })).statusCode).toBe(200);
  expect((await buy(cookie, 'swarm-hunt', { level: 1, season: SEASON.id })).statusCode).toBe(200);
  // A node no longer in the tree (an old config) is not counted either.
  await ctx.db.insertInto('galaxy.lab_nodes').values({ account_id: account, node: 'viejo', level: 5, updated_at: clock }).execute();
  const v = (await get(ctx.app, '/galaxy/api/redshift', { cookie })).json() as RedshiftView;
  expect(v.labLevels).toBe(1);
});
