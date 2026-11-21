import { randomBytes, randomUUID } from 'node:crypto';
import { type HallOfFame, madridDayOf, madridMidnightOf, parseConfig, PROBE_TEST, type SeasonView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { saveSeasonDraft, scheduleSeason } from '../../src/season/records';
import { get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Seasons as records in the running server (plan «temporadas como fichas», 2026-11-21): the season a player sees is the
// record open at that moment, with its own currency; one that ended while the next is open is archived on the first
// read with its own closing prizes. No other file makes season records, and no run of theirs is ten days old.

const tag = randomBytes(3).toString('hex');
const ENDED = `te-${tag}`;
const OPEN = `to-${tag}`;
// Madrid midnights around today: one season that ended ten days ago and one open now (no other file makes records).
const today = madridDayOf(new Date().toISOString());
const dayOff = (n: number) => {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return madridMidnightOf(new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10));
};
const actor = { id: null, label: 'test' };
const ctx = { labNodes: parseConfig('lab', {}).nodes, anomalies: ['contagion'] };
let app: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  app = await testApp({ seasons: true });
  await saveSeasonDraft(app.db, { id: ENDED, name: 'Prueba acabada', startsAt: dayOff(-20), endsAt: dayOff(-10), rules: { anomaly: 'contagion', tiers: [100, 200, 300, 400, 500] }, route: { currency: { name: 'Polvillo', perPoint: 1, dustRate: 1 } } }, ctx, actor, 'Prueba');
  await saveSeasonDraft(app.db, { id: OPEN, name: 'Prueba abierta', startsAt: dayOff(-10), endsAt: dayOff(20), rules: { anomaly: 'contagion' }, route: { currency: { name: 'Astillas', perPoint: 1, dustRate: 1 } } }, ctx, actor, 'Prueba');
  await scheduleSeason(app.db, ENDED, ctx, actor, 'Prueba');
  await scheduleSeason(app.db, OPEN, ctx, actor, 'Prueba');
});
afterAll(async () => {
  // Records never meet another file: they go (their archive stays, under ids nobody else uses).
  await app.db.deleteFrom('galaxy.seasons').where('id', 'in', [ENDED, OPEN]).execute();
  await app.close();
});

async function player() {
  const username = uniqueName('srec');
  const res = await post(app.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const accountId = (res.json() as { id: string }).id;
  await post(app.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { username, cookie, accountId };
}

test('el jugador ve la temporada abierta de las fichas, con su moneda; la que acabó se archiva con sus propios premios', async () => {
  const p = await player();
  await app.db.insertInto('galaxy.season_adjustments').values({ account_id: p.accountId, season: ENDED, points: 250 }).execute();
  const view = (await get(app.app, '/galaxy/api/season', { cookie: p.cookie })).json() as SeasonView;
  expect(view.season).toMatchObject({ id: OPEN, name: 'Prueba abierta' });
  expect(view.currency.name).toBe('Astillas');
  // The ended season closed on this read: 250 points is Plata in its own tiers (100, 200…).
  expect(view.closing).toMatchObject({ season: ENDED, rank: 1, score: 250, tier: 'silver' });
  const state = await app.db.selectFrom('galaxy.seasons').select('state').where('id', '=', ENDED).executeTakeFirstOrThrow();
  expect(state.state).toBe('closed');
  const claim = await post(app.app, `/galaxy/api/season/results/${ENDED}/claim`, undefined, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
  expect(claim.statusCode).toBe(200);
  const hall = (await get(app.app, '/galaxy/api/hall-of-fame', { cookie: p.cookie })).json() as HallOfFame;
  expect(hall.seasons.find((s) => s.season === ENDED)).toMatchObject({ name: 'Prueba acabada', players: 1 });
});
