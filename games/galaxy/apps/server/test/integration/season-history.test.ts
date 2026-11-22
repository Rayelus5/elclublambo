import { randomBytes } from 'node:crypto';
import { type Leaderboard, madridMidnightOf, parseConfig, PROBE_TEST, type SeasonResults, type SeasonsHistory, type SeasonView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createSeasonStore, closeEndedSeasons, saveSeasonDraft, scheduleSeason } from '../../src/season/records';
import { createAdminViaCli, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The past seasons for players (plan «temporadas como fichas», histórico, 2026-11-22): every closed season with its
// podium and its numbers, its final ranking a page at a time with your row even outside the page, its tiers and the
// prizes its close paid; and an admin's preview of a season still to come in the leaderboard, with nobody on it.
// A week of 2023 picked at random (no run reaches it, only the points given here rank) and a season far ahead, under
// ids of their own, back to draft and removed at the end so no other file meets them (the archive stays: it takes no
// deletes).

const tag = randomBytes(3).toString('hex');
const PAST = `hp-${tag}`;
const FUTURE = `hf-${tag}`;
const day = (base: string, plus: number) => {
  const d = new Date(`${base}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + plus);
  return madridMidnightOf(d.toISOString().slice(0, 10));
};
const offset = Math.floor(Math.random() * 300);
const past = { startsAt: day('2023-01-02', offset), endsAt: day('2023-01-09', offset) };
const actor = { id: null, label: 'test' };
const ctx = { labNodes: parseConfig('lab', {}).nodes, anomalies: ['contagion'] };
const closing = (podiumSize: number) => ({ ...parseConfig('seasonRoute', {}).closing, podiumSize });
let app: Awaited<ReturnType<typeof testApp>>;
let admin: { cookie: string };
const players: { username: string; cookie: string; accountId: string }[] = [];

async function player(points: number) {
  const username = uniqueName('shis');
  const res = await post(app.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const accountId = (res.json() as { id: string }).id;
  await post(app.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await app.db.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season: PAST, points }).execute();
  return { username, cookie, accountId };
}

beforeAll(async () => {
  app = await testApp();
  await saveSeasonDraft(app.db, { id: PAST, name: 'Temporada pasada de prueba', ...past, rules: { anomaly: 'contagion', tiers: [100, 1000, 4000, 8000, 20000], top: 3 }, route: { closing: closing(2) } }, ctx, actor, 'Prueba');
  await saveSeasonDraft(app.db, { id: FUTURE, name: 'Temporada futura de prueba', startsAt: '2097-01-31T23:00:00.000Z', endsAt: '2097-02-28T23:00:00.000Z', rules: { anomaly: 'contagion' }, route: { closing: closing(4) } }, ctx, actor, 'Prueba');
  await scheduleSeason(app.db, FUTURE, ctx, actor, 'Prueba');
  // In order, so the tie at 5000 breaks the same way every time: whoever got there first.
  for (const points of [9000, 5000, 5000, 600, 50]) players.push(await player(points));
  // Scheduled back then and over long ago (scheduling one already over is refused, so it is set directly), then closed
  // as the minute's pass closes it: with its own tiers and closing prizes.
  await app.db.updateTable('galaxy.seasons').set({ state: 'scheduled' }).where('id', '=', PAST).execute();
  await closeEndedSeasons(app.db, createSeasonStore(app.db, { ttlMs: 0 }), 60, new Date());

  const { username, password, totpSecret } = await createAdminViaCli(app.db, 'admin');
  const login = await post(app.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(app.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  admin = { cookie: sessionCookie(res) };
});
afterAll(async () => {
  await app.db.updateTable('galaxy.seasons').set({ state: 'draft' }).where('id', 'in', [PAST, FUTURE]).execute();
  await app.db.deleteFrom('galaxy.seasons').where('id', 'in', [PAST, FUTURE]).execute();
  await app.close();
});

test('el histórico trae cada temporada cerrada, la más nueva primero, con su podio y sus números', async () => {
  const viewer = players.at(-1)!;
  const res = await get(app.app, '/galaxy/api/seasons/history', { cookie: viewer.cookie });
  expect(res.statusCode, res.body).toBe(200);
  const history = res.json() as SeasonsHistory;
  const ends = history.seasons.map((s) => Date.parse(s.endsAt));
  expect(ends).toEqual([...ends].sort((a, b) => b - a));
  const mine = history.seasons.find((s) => s.id === PAST)!;
  expect(mine).toMatchObject({ name: 'Temporada pasada de prueba', startsAt: past.startsAt, endsAt: past.endsAt, players: 5 });
  // The first three by rank (the tie at 5000 shares second place), each with their look.
  expect(mine.podium.map((p) => p.rank)).toEqual([1, 2, 2]);
  expect(mine.podium[0]).toEqual({ rank: 1, username: players[0]!.username, score: 9000, avatar: null, frame: null });
  expect(new Set(mine.podium.slice(1).map((p) => p.username))).toEqual(new Set([players[1]!.username, players[2]!.username]));
  expect(mine.stats).toMatchObject({ players: 5, runs: 0, tiers: { bronze: 1, silver: 0, gold: 2, platinum: 1, stellar: 0 } });
});

test('la clasificación final de una temporada pasada, por páginas, con tu fila aunque no esté en la página', async () => {
  const viewer = players.at(-1)!;
  const res = await get(app.app, `/galaxy/api/seasons/${PAST}/results`, { cookie: viewer.cookie });
  expect(res.statusCode, res.body).toBe(200);
  const v = res.json() as SeasonResults;
  // As many rows as its table showed (its own `top`, 3 here).
  expect(v.rows.map((r) => [r.rank, r.username, r.value, r.tier])).toEqual([
    [1, players[0]!.username, 9000, 'platinum'],
    [2, players[1]!.username, 5000, 'gold'],
    [2, players[2]!.username, 5000, 'gold'],
  ]);
  // A podium of two: the third of the first three ranks without its prize.
  expect(v.rows.map((r) => r.podium)).toEqual([true, true, false]);
  expect(typeof v.rows[0]!.level).toBe('number');
  expect(v.me).toMatchObject({ rank: 5, username: viewer.username, value: 50, tier: null, podium: false });
  expect(v.total).toBe(5);
  expect(v.next).toBe(3);
  expect(v.season).toMatchObject({ id: PAST, name: 'Temporada pasada de prueba', startsAt: past.startsAt, endsAt: past.endsAt, players: 5, tiers: [100, 1000, 4000, 8000, 20000] });
  expect(v.season.closing).toMatchObject({ podiumSize: 2 });
  expect(v.season.stats).toMatchObject({ players: 5 });

  const rest = (await get(app.app, `/galaxy/api/seasons/${PAST}/results?offset=3`, { cookie: viewer.cookie })).json() as SeasonResults;
  expect(rest.rows.map((r) => [r.rank, r.value, r.tier])).toEqual([
    [4, 600, 'bronze'],
    [5, 50, null],
  ]);
  expect(rest.next).toBeNull();
  const one = (await get(app.app, `/galaxy/api/seasons/${PAST}/results?limit=1`, { cookie: viewer.cookie })).json() as SeasonResults;
  expect(one.rows).toHaveLength(1);
  expect(one.next).toBe(1);
});

test('una temporada que no ha cerrado no tiene resultados, y sin sesión no se ven', async () => {
  const viewer = players.at(-1)!;
  expect((await get(app.app, `/galaxy/api/seasons/${FUTURE}/results`, { cookie: viewer.cookie })).json()).toEqual({ error: 'season_not_found' });
  expect((await get(app.app, `/galaxy/api/seasons/no-existe-${tag}/results`, { cookie: viewer.cookie })).statusCode).toBe(404);
  expect((await get(app.app, `/galaxy/api/seasons/${PAST}/results?limit=0`, { cookie: viewer.cookie })).statusCode).toBe(400);
  expect((await get(app.app, '/galaxy/api/seasons/history')).statusCode).toBe(401);
  expect((await get(app.app, `/galaxy/api/seasons/${PAST}/results`)).statusCode).toBe(401);
});

test('un admin ve de antemano la clasificación de una temporada programada, sin nadie; un jugador no', async () => {
  const res = await get(app.app, `/galaxy/api/leaderboard?tab=general&season=${FUTURE}`, { cookie: admin.cookie });
  expect(res.statusCode, res.body).toBe(200);
  const board = res.json() as Leaderboard;
  expect(board).toMatchObject({ tab: 'general', rows: [], me: null, total: 0 });
  expect(board.season).toMatchObject({ id: FUTURE, name: 'Temporada futura de prueba', startsAt: '2097-01-31T23:00:00.000Z', endsAt: '2097-02-28T23:00:00.000Z' });
  expect(board.season!.tiers).toHaveLength(5);
  expect(board.season!.closing.podiumSize).toBe(4);
  expect((await get(app.app, `/galaxy/api/leaderboard?tab=clans&season=${FUTURE}`, { cookie: admin.cookie })).json()).toMatchObject({ clans: [], myClan: null, total: 0 });
  expect((await get(app.app, `/galaxy/api/leaderboard?tab=general&season=no-existe-${tag}`, { cookie: admin.cookie })).statusCode).toBe(404);
  expect((await get(app.app, `/galaxy/api/leaderboard?tab=general&season=${FUTURE}`, { cookie: players[0]!.cookie })).statusCode).toBe(403);

  // The season's own preview: its start to say when it opens, and none of the admin's own closing prizes.
  const preview = (await get(app.app, `/galaxy/api/season?preview=${FUTURE}`, { cookie: admin.cookie })).json() as SeasonView;
  expect(preview.season).toMatchObject({ id: FUTURE, startsAt: '2097-01-31T23:00:00.000Z' });
  expect(preview.closing).toBeNull();
});
