import { randomBytes, randomUUID } from 'node:crypto';
import {
  type AdminTournament,
  type AdminTournamentList,
  type AdminTournamentReview,
  type LiveEvent,
  madridMidnightOf,
  parseConfig,
  PROBE_TEST,
  type TournamentClaimResult,
  type TournamentDecideManyResult,
  type TournamentDetail,
  type TournamentEntryResult,
  type TournamentList,
  type TournamentRecordInput,
} from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { runCli } from '../../src/cli';
import { credit } from '../../src/economy/wallet';
import { scheduleSeason, saveSeasonDraft } from '../../src/season/records';
import { tournamentTick } from '../../src/tournaments/jobs';
import { joinTournament, leaveTournament } from '../../src/tournaments/player';
import { scoringOf, scoringSeason, tournamentById } from '../../src/tournaments/records';
import { inlineReplayer, type Replayer } from '../../src/tournaments/replayer';
import { finishTournament, processNextCheck } from '../../src/tournaments/review';
import { computeTournamentRanking } from '../../src/tournaments/scoring';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, testEnv, totpNow, uniqueName } from '../helpers';
import { playedRun } from '../replay-fixture';

// Tournaments (plan «temporadas como fichas», part 5; GDD §13.3) against the real database: preparing and scheduling one,
// signing up and leaving with a fee, one exclusive tournament at a time even with two sign-ups at once, cancelling with
// every fee back once, the ranking of each measure with its filters and from the sign-up, the review (a replay that does
// not match, a run that cannot be checked and waits for an admin), the results with who cannot win prizes passing theirs
// on, collecting once and the notices sent once. Everything happens inside a season of its own, years ahead, made and
// removed by this file: no other file's data counts.

const tag = randomBytes(3).toString('hex');
const SEASON = `tt-${tag}`;
const year = 2035 + (randomBytes(1)[0]! % 10);
const month = 1 + (randomBytes(1)[0]! % 9);
const day = (m: number, d: number) => madridMidnightOf(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
const SEASON_START = day(month, 1);
const SEASON_END = day(month + 3, 1);
const H = 3_600_000;
/** The n-th tournament's window: two days, one after another inside the season. */
const windowOf = (n: number) => {
  const startsAt = new Date(Date.parse(SEASON_START) + (1 + n * 3) * 24 * H);
  return { startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 48 * H).toISOString(), at: (hours: number) => new Date(startsAt.getTime() + hours * H) };
};
const config = fixedConfig({});
const coins = (amount: number) => ({ kind: 'currency' as const, currency: 'coins' as const, amount });

let app: Awaited<ReturnType<typeof testApp>>;
type Staff = { cookie: string; password: string; id: string };
let admin: Staff;
let superadmin: Staff;
/** Who prepares the tournaments the other tests need (each admin has its own limit of changes a minute). */
let organizer: Staff;
const slugs: string[] = [];

async function staff(role: 'admin' | 'superadmin'): Promise<Staff> {
  const { username, password, totpSecret } = await createAdminViaCli(app.db, role);
  const login = await post(app.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(app.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  const id = (await app.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;
  return { cookie: sessionCookie(res), password, id };
}

beforeAll(async () => {
  app = await testApp({ config });
  const ctx = { labNodes: parseConfig('lab', {}).nodes, anomalies: [] };
  const actor = { id: null, label: 'test' };
  await saveSeasonDraft(app.db, { id: SEASON, name: 'Temporada de torneos', startsAt: SEASON_START, endsAt: SEASON_END, rules: { points: { layer: 10, core: 100, extraction: 50 }, capPerMinute: 1000, anomaly: null, finish: null } }, ctx, actor, 'Prueba');
  await scheduleSeason(app.db, SEASON, ctx, actor, 'Prueba');
  admin = await staff('admin');
  superadmin = await staff('superadmin');
  organizer = await staff('admin');
});

afterAll(async () => {
  // Back to drafts and removed, with their entries, checks and money (the cascade of a draft).
  if (slugs.length > 0) {
    await app.db.updateTable('galaxy.tournaments').set({ state: 'draft' }).where('slug', 'in', slugs).execute();
    await app.db.deleteFrom('galaxy.tournaments').where('slug', 'in', slugs).execute();
  }
  await app.db.updateTable('galaxy.seasons').set({ state: 'draft' }).where('id', '=', SEASON).execute();
  await app.db.deleteFrom('galaxy.seasons').where('id', '=', SEASON).execute();
  await app.close();
});

async function player(name = 'tor') {
  const username = uniqueName(name);
  const res = await post(app.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(app.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { id, username, cookie };
}

function record(n: number, over: Partial<TournamentRecordInput> = {}): TournamentRecordInput {
  const slug = `t-${tag}-${n}-${randomBytes(2).toString('hex')}`;
  slugs.push(slug);
  const w = windowOf(n);
  return { slug, seasonId: SEASON, title: `Torneo ${n}`, startsAt: w.startsAt, endsAt: w.endsAt, metric: 'points', prizes: [{ from: 1, to: 1, gifts: [coins(1000)] }], ...over };
}

/** A tournament prepared and scheduled through the panel (a superadmin when its prizes need one). */
async function scheduled(rec: TournamentRecordInput, by: Staff = organizer): Promise<AdminTournament> {
  const made = await post(app.app, '/galaxy/api/admin/tournaments', { record: rec, reason: 'Torneo de prueba' }, { cookie: by.cookie });
  expect(made.statusCode, made.body).toBe(201);
  const t = made.json() as AdminTournament;
  const res = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/schedule`, { version: t.version, reason: 'Listo', password: by.password }, { cookie: by.cookie });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as AdminTournament;
}

const key = () => randomUUID();
const join = (cookie: string, id: string, k = key()) => post(app.app, `/galaxy/api/tournaments/${id}/join`, undefined, { cookie, headers: { 'idempotency-key': k } });
const leave = (cookie: string, id: string, k = key()) => post(app.app, `/galaxy/api/tournaments/${id}/leave`, undefined, { cookie, headers: { 'idempotency-key': k } });
const claim = (cookie: string, id: string, k = key()) => post(app.app, `/galaxy/api/tournaments/${id}/claim`, undefined, { cookie, headers: { 'idempotency-key': k } });
const coinsOf = async (id: string) => Number((await app.db.selectFrom('galaxy.balances').select('amount').where('account_id', '=', id).where('currency', '=', 'coins').executeTakeFirst())?.amount ?? 0);

type RunSpec = { at: Date; depth?: number; kills?: number; cores?: number; outcome?: 'extracted' | 'died' | 'abandoned'; seconds?: number; sector?: string; probe?: string; suspicious?: boolean; coop?: boolean; simVersion?: string };

/** A finished run straight in the table (a group run with its group's row when `coop`). */
async function finishedRun(accountId: string, r: RunSpec, extra: { seed?: string; claim?: object; ticks?: number; hash?: string; level?: number } = {}): Promise<string> {
  let coopRunId: string | null = null;
  if (r.coop) {
    const c = await app.db
      .insertInto('galaxy.coop_runs')
      .values({ room_code: 'TOR234', kind: 'private', leader_id: accountId, sector: r.sector ?? 'outer-nebula', seed: '9', anomaly: null, rules: '{}', players: '[]', content_version: 0, sim_version: SIM_VERSION })
      .returning('id')
      .executeTakeFirstOrThrow();
    await app.db.updateTable('galaxy.coop_runs').set({ state: 'ended', outcome: 'died', ticks: 36_000, depth: r.depth ?? 1, boss_kills: r.cores ?? 0, hash: '0123456789abcdef', ended_at: r.at }).where('id', '=', c.id).execute();
    coopRunId = c.id;
  }
  const row = await app.db
    .insertInto('galaxy.runs')
    .values({
      account_id: accountId,
      seed: extra.seed ?? '1',
      sector: r.sector ?? 'outer-nebula',
      probe: r.probe ?? 'lumen',
      relics: '[]',
      content_version: 0,
      sim_version: r.simVersion ?? SIM_VERSION,
      start_key: randomUUID(),
      started_at: new Date(r.at.getTime() - 600_000),
      finished_at: r.at,
      outcome: r.outcome ?? 'died',
      ticks: extra.ticks ?? 36_000,
      depth: r.depth ?? 1,
      kills: r.kills ?? 10,
      boss_kills: r.cores ?? 0,
      level: extra.level ?? 5,
      seconds: r.seconds ?? 600,
      hash: extra.hash ?? '0123456789abcdef',
      payout: '{}',
      runs_version: 0,
      claim: extra.claim ? JSON.stringify(extra.claim) : null,
      flags: r.suspicious ? ['kills_rate'] : [],
      suspicious: r.suspicious ?? false,
      ...(coopRunId ? { coop_run_id: coopRunId, slot: 0, party_size: 2 } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const sent: { ids: string[]; event: LiveEvent }[] = [];
const live = { send: (id: string, event: LiveEvent) => void sent.push({ ids: [id], event }), sendMany: (ids: Iterable<string>, event: LiveEvent) => void sent.push({ ids: [...ids], event }) };
const tick = (now: Date) => tournamentTick({ db: app.db, config, now: () => now, live, replayer: inlineReplayer() });
const deps = (now: Date) => ({ db: app.db, config, now: () => now });
const review = async (id: string) => (await get(app.app, `/galaxy/api/admin/tournaments/${id}/review`, { cookie: admin.cookie })).json() as AdminTournamentReview;

describe('preparar y programar', () => {
  test('la ficha se valida, se guarda como borrador invisible y se programa a su versión con la contraseña', async () => {
    const bad = await post(app.app, '/galaxy/api/admin/tournaments/validate', { record: record(0, { prizes: [{ from: 2, to: 3, gifts: [coins(1)] }], entry: { currency: 'coins', amount: 10 } }) }, { cookie: admin.cookie });
    expect(bad.json().ok).toBe(false);
    expect(bad.json().issues.map((i: { message: string }) => i.message)).toContain('prizes_start');
    const outside = await post(app.app, '/galaxy/api/admin/tournaments/validate', { record: record(0, { endsAt: SEASON_END.replace(/^(\d{4})/, (y) => String(Number(y) + 1)) }) }, { cookie: admin.cookie });
    expect(outside.json().issues.map((i: { message: string }) => i.message)).toEqual(expect.arrayContaining(['tournament_too_long']));

    const rec = record(0);
    const made = await post(app.app, '/galaxy/api/admin/tournaments', { record: rec, reason: 'Borrador' }, { cookie: admin.cookie });
    expect(made.statusCode).toBe(201);
    const draft = made.json() as AdminTournament;
    expect(draft).toMatchObject({ state: 'draft', version: 1, record: { slug: rec.slug } });
    const p = await player();
    const list = (await get(app.app, '/galaxy/api/tournaments', { cookie: p.cookie })).json() as TournamentList;
    expect([...list.upcoming, ...list.running].map((c) => c.id)).not.toContain(draft.id);
    expect((await get(app.app, `/galaxy/api/tournaments/${rec.slug}`, { cookie: p.cookie })).statusCode).toBe(404);
    // The same slug twice is refused.
    expect((await post(app.app, '/galaxy/api/admin/tournaments', { record: { ...rec }, reason: 'Otra vez' }, { cookie: admin.cookie })).statusCode).toBe(400);

    const edited = await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}`, { record: { ...rec, title: 'Torneo editado' }, version: 1, reason: 'Título' }, { cookie: admin.cookie });
    expect(edited.json()).toMatchObject({ version: 2, record: { title: 'Torneo editado' } });
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}`, { record: rec, version: 1, reason: 'Vieja' }, { cookie: admin.cookie })).json().error).toBe('tournament_conflict');
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}/schedule`, { version: 1, reason: 'Vieja', password: admin.password }, { cookie: admin.cookie })).json().error).toBe('tournament_conflict');
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}/schedule`, { version: 2, reason: 'Mal', password: 'no-es-esta' }, { cookie: admin.cookie })).json().error).toBe('password_wrong');
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}/schedule`, { version: 2, reason: 'Listo', password: admin.password }, { cookie: p.cookie })).statusCode).toBe(403);
    const ok = await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}/schedule`, { version: 2, reason: 'Listo', password: admin.password }, { cookie: admin.cookie });
    expect(ok.json()).toMatchObject({ state: 'scheduled', version: 3 });
    const upcoming = (await get(app.app, '/galaxy/api/tournaments', { cookie: p.cookie })).json() as TournamentList;
    expect(upcoming.upcoming.find((c) => c.id === draft.id)).toMatchObject({ title: 'Torneo editado', join: { open: true, block: null }, me: null });
    // Taken back before it starts while nobody is in it.
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${draft.id}/unschedule`, { reason: 'Aún no', password: admin.password }, { cookie: admin.cookie })).json()).toMatchObject({ state: 'draft' });
    const audit = await app.db.selectFrom('galaxy.admin_audit_log').select('action').where('target_id', '=', draft.id).orderBy('id').execute();
    expect(audit.map((a) => a.action)).toEqual(['tournament.saved', 'tournament.saved', 'tournament.scheduled', 'tournament.unscheduled']);
  });

  test('un premio en dinero solo lo programa un superadmin', async () => {
    const made = await post(app.app, '/galaxy/api/admin/tournaments', { record: record(1, { prizes: [{ from: 1, to: 1, gifts: [], cash: { amountEur: 25, note: 'Tarjeta' } }] }), reason: 'Con dinero' }, { cookie: admin.cookie });
    const t = made.json() as AdminTournament;
    expect(t.bigReasons).toEqual(['cash']);
    const refused = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/schedule`, { version: t.version, reason: 'Listo', password: admin.password }, { cookie: admin.cookie });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'tournament_needs_superadmin', reasons: ['cash'] });
    const ok = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/schedule`, { version: t.version, reason: 'Listo', password: superadmin.password }, { cookie: superadmin.cookie });
    expect(ok.json()).toMatchObject({ state: 'scheduled' });
  });
});

describe('inscribirse y salir', () => {
  test('la entrada se cobra una vez, salir no la devuelve y no se vuelve; con la misma clave, la misma respuesta', async () => {
    const t = await scheduled(record(2, { entry: { currency: 'coins', amount: 100 } }));
    const p = await player();
    await credit(app.db, p.id, 'coins', 500, 'test');
    const k = key();
    const first = await join(p.cookie, t.id, k);
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json() as TournamentEntryResult).me).toMatchObject({ status: 'joined', rank: null, score: 0 });
    expect((first.json() as TournamentEntryResult).wallet.coins).toBe(400);
    expect((await join(p.cookie, t.id, k)).json()).toEqual(first.json());
    expect((await join(p.cookie, t.id)).json().error).toBe('tournament_joined');
    expect(await coinsOf(p.id)).toBe(400);
    const card = ((await get(app.app, '/galaxy/api/tournaments', { cookie: p.cookie })).json() as TournamentList).upcoming.find((c) => c.id === t.id)!;
    expect(card).toMatchObject({ entrants: 1, me: { status: 'joined' }, join: { open: false, block: 'joined' } });

    const out = await leave(p.cookie, t.id);
    expect((out.json() as TournamentEntryResult).me.status).toBe('left');
    expect((await join(p.cookie, t.id)).json().error).toBe('tournament_left');
    expect((await leave(p.cookie, t.id)).json().error).toBe('tournament_left');
    expect(await coinsOf(p.id)).toBe(400);

    const poor = await player();
    expect((await join(poor.cookie, t.id)).json().error).toBe('insufficient_funds');
    expect((await app.db.selectFrom('galaxy.tournament_entries').select('account_id').where('tournament_id', '=', t.id).where('account_id', '=', poor.id).executeTakeFirst())).toBeUndefined();
  });

  test('el nivel mínimo y el cupo', async () => {
    const high = await scheduled(record(3, { filters: { minLevel: 50 } }));
    const p = await player();
    const refused = await join(p.cookie, high.id);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: 'level_too_low', minLevel: 50 });
    const small = await scheduled(record(4, { maxEntrants: 1, exclusive: false }));
    expect((await join(p.cookie, small.id)).statusCode).toBe(200);
    expect((await join((await player()).cookie, small.id)).json().error).toBe('tournament_full');
  });

  test('dos inscripciones a la vez en dos exclusivos que se solapan: solo entra una; uno no exclusivo o sin solape, sí', async () => {
    const w = windowOf(5);
    const a = await scheduled(record(5));
    const b = await scheduled(record(6, { startsAt: w.at(24).toISOString(), endsAt: w.at(60).toISOString() }));
    const open = await scheduled(record(7, { startsAt: w.startsAt, endsAt: w.endsAt, exclusive: false }));
    const later = await scheduled(record(8));
    const p = await player();
    const [x, y] = await Promise.all([join(p.cookie, a.id), join(p.cookie, b.id)]);
    const codes = [x, y].map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const loser = x.statusCode === 409 ? x : y;
    expect(loser.json().error).toBe('tournament_exclusive');
    expect(typeof loser.json().title).toBe('string');
    expect((await join(p.cookie, open.id)).statusCode).toBe(200);
    expect((await join(p.cookie, later.id)).statusCode).toBe(200);
    const rows = await app.db.selectFrom('galaxy.tournament_entries').select('tournament_id').where('account_id', '=', p.id).execute();
    expect(rows).toHaveLength(3);
  });
});

test('cancelar devuelve cada entrada una vez, también a quien salió, y avisa a los inscritos', async () => {
  const t = await scheduled(record(9, { entry: { currency: 'coins', amount: 250 } }));
  const [p, q] = [await player(), await player()];
  for (const x of [p, q]) await credit(app.db, x.id, 'coins', 250, 'test');
  await join(p.cookie, t.id);
  await join(q.cookie, t.id);
  await leave(q.cookie, t.id);
  expect([await coinsOf(p.id), await coinsOf(q.id)]).toEqual([0, 0]);
  sent.length = 0;
  const res = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/cancel`, { reason: 'No sale', password: admin.password }, { cookie: admin.cookie });
  expect(res.json()).toMatchObject({ state: 'cancelled', refunded: 2 });
  expect([await coinsOf(p.id), await coinsOf(q.id)]).toEqual([250, 250]);
  expect((await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/cancel`, { reason: 'Otra vez', password: admin.password }, { cookie: admin.cookie })).json().error).toBe('tournament_finished');
  const refunds = await app.db.selectFrom('galaxy.ledger').select('account_id').where('operation_key', '=', `tournament:${t.id}:refund`).execute();
  expect(refunds.map((r) => r.account_id).sort()).toEqual([p.id, q.id].sort());
  const card = ((await get(app.app, '/galaxy/api/tournaments', { cookie: p.cookie })).json() as TournamentList).finished.find((c) => c.id === t.id)!;
  expect(card).toMatchObject({ state: 'cancelled', me: { refunded: true } });
});

describe('la clasificación', () => {
  test('cada medida, con sus filtros y solo desde la inscripción (la de temporada, desde el inicio de la temporada)', async () => {
    const w = windowOf(10);
    const t = await scheduled(record(10, { metric: 'points', filters: { sector: 'outer-nebula', probe: 'lumen', mode: 'solo' } }));
    const [a, b, c, d] = [await player('ta'), await player('tb'), await player('tc'), await player('td')];
    await joinTournament(deps(w.at(1)), a.id, t.id, key());
    await joinTournament(deps(w.at(5)), b.id, t.id, key());
    await joinTournament(deps(w.at(1)), c.id, t.id, key());
    await joinTournament(deps(w.at(1)), d.id, t.id, key());
    await leaveTournament(deps(w.at(2)), c.id, t.id, key());
    // a: counts 180 (layer 3, a Core, extracted) and 20; the rest is left out by a filter or the rules.
    await finishedRun(a.id, { at: w.at(2), depth: 3, cores: 1, outcome: 'extracted', kills: 40 });
    await finishedRun(a.id, { at: w.at(3), depth: 2, kills: 5 });
    await finishedRun(a.id, { at: w.at(0.5), depth: 9 }); // before signing up
    await finishedRun(a.id, { at: w.at(4), depth: 9, sector: 'frost-rings' });
    await finishedRun(a.id, { at: w.at(4), depth: 9, probe: 'vector' });
    await finishedRun(a.id, { at: w.at(4), depth: 9, coop: true });
    await finishedRun(a.id, { at: w.at(4), depth: 9, suspicious: true });
    await finishedRun(a.id, { at: w.at(4), depth: 9, seconds: 30 });
    await finishedRun(a.id, { at: w.at(49), depth: 9 }); // after the end
    await finishedRun(a.id, { at: new Date(Date.parse(SEASON_START) + H), depth: 4 }); // in the season, before the tournament
    // b: one run before signing up, one after.
    await finishedRun(b.id, { at: w.at(3), depth: 8, kills: 99 });
    await finishedRun(b.id, { at: w.at(6), depth: 6, kills: 7, outcome: 'extracted' });
    // c left: nothing of theirs counts. d never played.
    await finishedRun(c.id, { at: w.at(3), depth: 9 });

    const row = await tournamentById(app.db, t.id);
    const season = await scoringSeason(app.db, row);
    const rank = async (metric: TournamentRecordInput['metric']) => {
      const r = await computeTournamentRanking(app.db, { ...scoringOf(row), metric }, season, 60);
      return { rows: r.rows.map((x) => [x.username, x.rank, x.value]), runs: Object.fromEntries([...r.entrants.values()].map((x) => [x.username, x.runs])) };
    };
    const points = await rank('points');
    expect(points.rows).toEqual([
      [a.username, 1, 200],
      [b.username, 2, 110],
    ]);
    expect(points.runs).toEqual({ [a.username]: 2, [b.username]: 1, [d.username]: 0 });
    expect((await rank('kills')).rows).toEqual([
      [a.username, 1, 45],
      [b.username, 2, 7],
    ]);
    expect((await rank('runs')).rows).toEqual([
      [a.username, 1, 2],
      [b.username, 2, 1],
    ]);
    expect((await rank('best_run')).rows).toEqual([
      [a.username, 1, 180],
      [b.username, 2, 110],
    ]);
    expect((await rank('depth')).rows).toEqual([
      [b.username, 1, 6],
      [a.username, 2, 3],
    ]);
    expect((await rank('cores')).rows).toEqual([[a.username, 1, 1]]);
    // Tied at one extraction each: whoever got there first.
    expect((await rank('extractions')).rows).toEqual([
      [a.username, 1, 1],
      [b.username, 2, 1],
    ]);
    // The season's points: from the season's start (the runs before signing up too), never after the tournament.
    expect((await rank('season_points')).rows).toEqual([
      [a.username, 1, 200 + 90 + 40],
      [b.username, 2, 110 + 80],
    ]);

    // What the player sees once it runs: their place, their score and their runs that count.
    await tick(w.at(1));
    const detail = (await get(app.app, `/galaxy/api/tournaments/${row.record.slug}`, { cookie: a.cookie })).json() as TournamentDetail;
    expect(detail.mine).toMatchObject({ rank: 1, score: 200, me: true, place: 1 });
    expect(detail.ranking.map((r) => r.username)).toEqual([a.username, b.username]);
    expect(detail.myRuns.map((r) => r.points)).toEqual([20, 180]);
    expect(detail.myRuns.map((r) => r.value)).toEqual([20, 180]);
  });
});

describe('la revisión y los resultados', () => {
  test('una partida que no coincide pasa a sospechosa y sube el siguiente; una que no se puede comprobar espera a un admin', async () => {
    const w = windowOf(12);
    const t = await scheduled(record(12, { prizes: [{ from: 1, to: 2, gifts: [coins(300)] }], reviewHours: 0 }));
    const [cheat, blind, honest, third] = [await player('tcheat'), await player('tblind'), await player('thonest'), await player('tthird')];
    for (const p of [cheat, blind, honest, third]) expect((await join(p.cookie, t.id)).statusCode).toBe(200);
    const real = playedRun(900);
    const s = real.summary;
    const claimOf = (over: object = {}) => ({ ticks: s.ticks, depth: s.depth, kills: s.kills, bossKills: s.bossKills, level: s.level, ...over });
    const played = { seed: real.start.seed, ticks: s.ticks, hash: s.hash, level: s.level };
    const outcome = real.run.outcome!;
    // The cheater claims five kills more than the run had; the blind one kept no inputs.
    // The kept depth (what the ranking reads) orders them; the replay compares what each client sent.
    const cheatRun = await finishedRun(cheat.id, { at: w.at(2), depth: s.depth + 3, kills: s.kills, cores: s.bossKills, outcome }, { ...played, claim: claimOf({ kills: s.kills + 5 }) });
    const blindRun = await finishedRun(blind.id, { at: w.at(3), depth: s.depth + 2, kills: s.kills, cores: s.bossKills, outcome }, { ...played, claim: claimOf() });
    const honestRun = await finishedRun(honest.id, { at: w.at(4), depth: s.depth + 1, kills: s.kills, cores: s.bossKills, outcome }, { ...played, claim: claimOf() });
    await finishedRun(third.id, { at: w.at(5), depth: s.depth, kills: 1, cores: 0, outcome: 'died' }, { claim: claimOf() });
    for (const id of [cheatRun, honestRun]) await app.db.insertInto('galaxy.run_inputs').values({ run_id: id, inputs: Buffer.from(real.bytes) }).execute();

    sent.length = 0;
    expect((await tick(w.at(1))).started).toContain(t.id);
    const ended = await tick(w.at(49));
    expect(ended.ended).toContain(t.id);
    // The cheater's run did not match: suspicious, and the honest one moved into the prizes and was replayed too.
    const mark = await app.db.selectFrom('galaxy.runs').select(['suspicious', 'flags']).where('id', '=', cheatRun).executeTakeFirstOrThrow();
    expect(mark).toEqual({ suspicious: true, flags: ['replay_mismatch'] });
    expect((await app.db.selectFrom('galaxy.admin_audit_log').select('action').where('target_id', '=', cheatRun).execute()).map((a) => a.action)).toEqual(['run.replay_mismatch']);
    let r = await review(t.id);
    const status = Object.fromEntries(r.checks.map((c) => [c.runId, c.status]));
    expect(status).toEqual({ [cheatRun]: 'mismatch', [blindRun]: 'unverifiable', [honestRun]: 'ok' });
    expect(r.checks.find((c) => c.runId === blindRun)!.detail).toEqual({ reason: 'inputs_missing' });
    expect(r.checks.find((c) => c.runId === cheatRun)!.detail!.rows!.filter((x) => !x.same).map((x) => x.key)).toEqual(['kills']);
    expect(r.ranking.map((x) => [x.username, x.place])).toEqual([
      [blind.username, 1],
      [honest.username, 2],
      [third.username, null],
    ]);
    // Nothing publishes while a run waits for a decision: not the job, not «Publicar ya».
    expect(r.canPublish).toBe(false);
    expect((await tick(w.at(60))).finished).not.toContain(t.id);
    const early = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/publish`, { reason: 'Publicar ya', password: admin.password }, { cookie: admin.cookie });
    expect(early.json()).toMatchObject({ error: 'tournament_pending', pending: 1 });
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/${honestRun}/decide`, { decision: 'accept', reason: 'Bien', password: admin.password }, { cookie: admin.cookie })).json().error).toBe('tournament_check_decided');

    const decided = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/${blindRun}/decide`, { decision: 'accept', reason: 'Vista a mano', password: admin.password }, { cookie: admin.cookie });
    expect(decided.statusCode, decided.body).toBe(200);
    r = decided.json() as AdminTournamentReview;
    expect(r.canPublish).toBe(true);
    expect(r.checks.find((c) => c.runId === blindRun)).toMatchObject({ decision: 'accept' });
    expect((await tick(w.at(61))).finished).toContain(t.id);
    const results = await app.db.selectFrom('galaxy.tournament_entries').select(['account_id', 'final_rank', 'rewards']).where('tournament_id', '=', t.id).execute();
    const of = (id: string) => results.find((x) => x.account_id === id)!;
    expect(of(blind.id)).toMatchObject({ final_rank: 1, rewards: { place: 1 } });
    expect(of(honest.id)).toMatchObject({ final_rank: 2, rewards: { place: 2 } });
    expect(of(cheat.id)).toMatchObject({ final_rank: null, rewards: null });
    expect(sent.filter((x) => x.event.type === 'notice' && x.event.notice.kind === 'tournament' && x.event.notice.id === t.id).map((x) => (x.event as { notice: { event: string } }).notice.event)).toEqual(['started', 'ended', 'finished']);
  });

  test('los resultados: quien no puede ganar premios conserva su puesto y el premio pasa al siguiente; se recogen una vez; el dinero lo marca un admin', async () => {
    const w = windowOf(14);
    const t = await scheduled(
      record(14, {
        metric: 'kills',
        filters: { mode: 'coop' },
        reviewHours: 0,
        prizes: [
          { from: 1, to: 1, gifts: [coins(1000)], cash: { amountEur: 30, note: 'Tarjeta regalo' } },
          { from: 2, to: 2, gifts: [coins(500)] },
        ],
        participation: { minRuns: 1, gifts: [{ kind: 'xp', amount: 50 }] },
      }),
      superadmin,
    );
    const [x, y, z, v] = [await player('tx'), await player('ty'), await player('tz'), await player('tv')];
    for (const p of [x, y, z, v]) expect((await join(p.cookie, t.id)).statusCode).toBe(200);
    await app.db.updateTable('galaxy.accounts').set({ prize_eligible: false }).where('id', '=', x.id).execute();
    await finishedRun(x.id, { at: w.at(2), kills: 300, coop: true });
    await finishedRun(y.id, { at: w.at(2), kills: 200, coop: true });
    await finishedRun(z.id, { at: w.at(3), kills: 100, coop: true });
    await finishedRun(v.id, { at: w.at(3), kills: 0, coop: true });

    // Group runs are refereed as they are played: nothing to replay, the results publish at the end of the review.
    await tick(w.at(1));
    expect((await tick(w.at(49))).finished).toContain(t.id);
    expect((await tick(w.at(50))).finished).not.toContain(t.id);

    const detail = (await get(app.app, `/galaxy/api/tournaments/${(await tournamentById(app.db, t.id)).record.slug}`, { cookie: y.cookie })).json() as TournamentDetail;
    expect(detail.state).toBe('finished');
    expect(detail.ranking.map((r) => [r.username, r.rank, r.eligible, r.place])).toEqual([
      [x.username, 1, false, null],
      [y.username, 2, true, 1],
      [z.username, 3, true, 2],
    ]);
    expect(detail.me).toMatchObject({ rank: 2, score: 200, runs: 1, claimed: false, rewards: { place: 1, cash: { amountEur: 30, note: 'Tarjeta regalo' }, participation: true } });

    // One mail per winner (the participation prize too), with the button to the tournament; none twice.
    const mails = await app.db
      .selectFrom('galaxy.mailbox_receipts as r')
      .innerJoin('galaxy.mailbox_messages as m', 'm.id', 'r.message_id')
      .select(['r.account_id', 'm.title', 'm.body', 'm.link'])
      .where('m.type', '=', 'tournament')
      .where('r.account_id', 'in', [x.id, y.id, z.id, v.id])
      .execute();
    expect(mails.map((m) => m.account_id).sort()).toEqual([y.id, z.id, v.id].sort());
    const mine = mails.find((m) => m.account_id === y.id)!;
    expect(mine.link).toBe(`/torneos/${detail.slug}`);
    expect(mine.body).toBe('Quedaste 2.º con 200 bajas. Tus premios te esperan en la página del torneo. Un admin te escribirá por el buzón para el premio en metálico');
    expect(mails.find((m) => m.account_id === v.id)!.body).toBe('Jugaste 1 partida en el torneo. Tu premio de participación te espera en la página del torneo');
    const box = (await get(app.app, '/galaxy/api/mailbox', { cookie: y.cookie })).json() as { messages: { type: string; link?: string | null }[] };
    expect(box.messages.find((m) => m.type === 'tournament')?.link).toBe(`/torneos/${detail.slug}`);

    // Collected once; the same key answers the same; who cannot win prizes has nothing to collect.
    const before = await coinsOf(y.id);
    const k = key();
    const got = await claim(y.cookie, t.id, k);
    expect(got.statusCode, got.body).toBe(200);
    expect((got.json() as TournamentClaimResult).items.map((i) => [i.gift.kind, i.outcome])).toEqual([
      ['currency', 'granted'],
      ['xp', 'granted'],
    ]);
    expect(await coinsOf(y.id)).toBe(before + 1000);
    expect((await claim(y.cookie, t.id, k)).json()).toEqual(got.json());
    expect((await claim(y.cookie, t.id)).json().error).toBe('already_claimed');
    expect(await coinsOf(y.id)).toBe(before + 1000);
    expect((await claim(x.cookie, t.id)).json().error).toBe('tournament_no_prize');

    // The money waits for an admin, who marks it paid once (audited).
    const cash = (await get(app.app, '/galaxy/api/admin/tournaments/cash', { cookie: admin.cookie })).json() as { cash: { tournamentId: string; username: string; paidAt: string | null; amountEur: number }[] };
    // The prize place (first among those who can win), not the overall rank (second, behind who cannot).
    expect(cash.cash.filter((c) => c.tournamentId === t.id)).toEqual([expect.objectContaining({ username: y.username, rank: 1, amountEur: 30, paidAt: null })]);
    const paid = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/cash/${y.username}/paid`, { reason: 'Pagado por transferencia', password: admin.password }, { cookie: admin.cookie });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().paidAt).not.toBeNull();
    expect((await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/cash/${y.username}/paid`, { reason: 'Otra vez', password: admin.password }, { cookie: admin.cookie })).json().error).toBe('tournament_cash_paid');
  });

  test('descalificar saca de la clasificación y sube al siguiente; quien no está inscrito no se puede descalificar', async () => {
    const w = windowOf(16);
    const t = await scheduled(record(16, { metric: 'kills', filters: { mode: 'coop' } }));
    const [p, q] = [await player('tdp'), await player('tdq')];
    for (const x of [p, q]) await join(x.cookie, t.id);
    await finishedRun(p.id, { at: w.at(2), kills: 90, coop: true });
    await finishedRun(q.id, { at: w.at(2), kills: 10, coop: true });
    const outsider = await player('tdo');
    const no = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/entries/${outsider.username}/disqualify`, { disqualified: true, reason: 'Nada', password: admin.password }, { cookie: admin.cookie });
    expect(no.json().error).toBe('tournament_not_joined');
    const res = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/entries/${p.username}/disqualify`, { disqualified: true, reason: 'Trampas', password: admin.password }, { cookie: admin.cookie });
    expect(res.statusCode, res.body).toBe(200);
    const r = res.json() as AdminTournamentReview;
    expect(r.ranking.map((x) => [x.username, x.place])).toEqual([[q.username, 1]]);
    expect(r.disqualified).toEqual([{ username: p.username, reason: 'Trampas' }]);
    const card = ((await get(app.app, '/galaxy/api/tournaments', { cookie: p.cookie })).json() as TournamentList).upcoming.find((c) => c.id === t.id)!;
    expect(card.me).toMatchObject({ status: 'disqualified', reason: 'Trampas' });
    expect((await join(p.cookie, t.id)).json().error).toBe('tournament_disqualified');
  });
});

/** A run the bot played, kept as the server keeps it (its own inputs, or none; another simulation's, maybe). */
async function realRun(accountId: string, at: Date, depth: number, opts: { inputs?: boolean; tamper?: boolean; simVersion?: string } = {}) {
  const real = playedRun(900);
  const s = real.summary;
  const claim = { ticks: s.ticks, depth: s.depth, kills: s.kills + (opts.tamper ? 5 : 0), bossKills: s.bossKills, level: s.level };
  const id = await finishedRun(accountId, { at, depth, kills: s.kills, cores: s.bossKills, outcome: real.run.outcome!, simVersion: opts.simVersion }, { seed: real.start.seed, ticks: s.ticks, hash: s.hash, level: s.level, claim });
  if (opts.inputs !== false) await app.db.insertInto('galaxy.run_inputs').values({ run_id: id, inputs: Buffer.from(real.bytes) }).execute();
  return { id };
}
const checkOf = (tournament: string, run: string) => app.db.selectFrom('galaxy.tournament_checks').select(['status', 'attempts', 'detail', 'decision']).where('tournament_id', '=', tournament).where('run_id', '=', run).executeTakeFirst();
const fixed = (verdict: Awaited<ReturnType<Replayer['verify']>>): Replayer => ({ verify: async () => verdict, close: async () => undefined });

describe('la revisión, a fondo (revisión del PR, 2026-11-22)', () => {
  test('publicar nunca da un premio a quien sube sin comprobar, aunque suba justo antes de publicar', async () => {
    const w = windowOf(18);
    const t = await scheduled(record(18, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    const [top, next] = [await player('trtop'), await player('trnext')];
    for (const p of [top, next]) expect((await join(p.cookie, t.id)).statusCode).toBe(200);
    const d = playedRun(900).summary.depth;
    const topRun = await realRun(top.id, w.at(2), d + 3);
    // The second has no inputs: checked, it could only wait for a decision.
    const nextRun = await realRun(next.id, w.at(3), d + 1, { inputs: false });
    await tick(w.at(1));
    // Ended and its prize place replayed, the results not out yet (the review takes an hour more here).
    await app.db.updateTable('galaxy.tournaments').set({ review_hours: 1 }).where('id', '=', t.id).execute();
    await tick(w.at(48.5));
    expect((await checkOf(t.id, topRun.id))?.status).toBe('ok');
    expect(await checkOf(t.id, nextRun.id)).toBeUndefined();
    // Something that does not wait for the tournament (an admin's mark, a ban) lands while the results are about to
    // publish: the top run stops counting and the second moves up.
    let calls = 0;
    const racing = {
      ...config,
      get: (async (key: string) => {
        if (key === 'account' && ++calls === 2) await app.db.updateTable('galaxy.runs').set({ suspicious: true }).where('id', '=', topRun.id).execute();
        return config.get(key as never);
      }) as typeof config.get,
    };
    await finishTournament({ db: app.db, config: racing, now: () => w.at(51) }, t.id);
    const won = await app.db.selectFrom('galaxy.tournament_entries').select(['account_id', 'rewards']).where('tournament_id', '=', t.id).execute();
    const winners = won.filter((x) => x.rewards !== null).map((x) => x.account_id);
    // Whoever wins rests on a run that was replayed and passed.
    expect(winners.filter((id) => id !== top.id)).toEqual([]);
  });

  test('al cerrar el servidor la comprobación en marcha sigue pendiente; un hilo caído se reintenta tres veces y después es un error', async () => {
    const w = windowOf(19);
    const t = await scheduled(record(19, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    const p = await player('trretry');
    await join(p.cookie, t.id);
    const run = await realRun(p.id, w.at(2), 5);
    await tick(w.at(1));
    // The end, with a replayer that is closing (a deploy): nothing is written.
    await tournamentTick({ db: app.db, config, now: () => w.at(49), live, replayer: fixed({ status: 'aborted' }) });
    expect(await checkOf(t.id, run.id)).toMatchObject({ status: 'pending', attempts: 0, detail: null });
    const dead = fixed({ status: 'error', detail: { reason: 'worker_failed' } });
    const step = () => processNextCheck({ db: app.db, config, now: () => w.at(50) }, dead, { tournament: t.id });
    expect(await step()).toBe('done');
    expect(await checkOf(t.id, run.id)).toMatchObject({ status: 'pending', attempts: 1 });
    await step();
    expect(await checkOf(t.id, run.id)).toMatchObject({ status: 'pending', attempts: 2 });
    await step();
    expect(await checkOf(t.id, run.id)).toMatchObject({ status: 'error', attempts: 3, detail: { reason: 'worker_failed' } });
  });

  test('un admin no acepta su propia partida ni decide la de otro del equipo; un superadmin, sí', async () => {
    const w = windowOf(20);
    const t = await scheduled(record(20, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    const playing = await staff('admin');
    expect((await join(playing.cookie, t.id)).statusCode).toBe(200);
    const run = await realRun(playing.id, w.at(2), 5, { inputs: false });
    await tick(w.at(1));
    await tick(w.at(49));
    expect((await checkOf(t.id, run.id))?.status).toBe('unverifiable');
    const decide = (by: Staff) => post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/${run.id}/decide`, { decision: 'accept', reason: 'Vista a mano', password: by.password }, { cookie: by.cookie });
    expect((await decide(playing)).json().error).toBe('tournament_self_accept');
    expect((await decide(admin)).json().error).toBe('staff_target');
    expect((await decide(superadmin)).statusCode).toBe(200);
  });

  test('tu propia partida sí la puedes descartar, una a una o en bloque; en bloque, aceptar se salta las tuyas', async () => {
    const w = windowOf(11);
    const t = await scheduled(record(11, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    const mine = await staff('admin');
    const myName = (await app.db.selectFrom('galaxy.accounts').select('username').where('id', '=', mine.id).executeTakeFirstOrThrow()).username;
    expect((await join(mine.cookie, t.id)).statusCode).toBe(200);
    // A sum: both runs back the prize place, and neither can be checked.
    const [one, two] = [await realRun(mine.id, w.at(2), 5, { inputs: false }), await realRun(mine.id, w.at(3), 4, { inputs: false })];
    await tick(w.at(1));
    await tick(w.at(49));
    expect([(await checkOf(t.id, one.id))?.status, (await checkOf(t.id, two.id))?.status]).toEqual(['unverifiable', 'unverifiable']);
    const many = (decision: 'accept' | 'discard') => post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/decide-many`, { decision, filter: { username: myName }, reason: 'Las mías', password: mine.password }, { cookie: mine.cookie });
    const accepted = (await many('accept')).json() as TournamentDecideManyResult;
    expect(accepted.decided).toBe(0);
    expect(accepted.skipped.map((x) => x.why)).toEqual(['tournament_self_accept', 'tournament_self_accept']);
    const own = await post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/${one.id}/decide`, { decision: 'discard', reason: 'Mejor que no cuente', password: mine.password }, { cookie: mine.cookie });
    expect(own.statusCode, own.body).toBe(200);
    expect(await checkOf(t.id, one.id)).toMatchObject({ decision: 'discard' });
    const discarded = (await many('discard')).json() as TournamentDecideManyResult;
    expect(discarded).toMatchObject({ decided: 1, skipped: [] });
    expect(await checkOf(t.id, two.id)).toMatchObject({ decision: 'discard' });
  });

  test('la partida de un superadmin la decide otro superadmin; un admin no, y él mismo no la acepta', async () => {
    const w = windowOf(13);
    const t = await scheduled(record(13, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    const owner = await staff('superadmin');
    expect((await join(owner.cookie, t.id)).statusCode).toBe(200);
    const run = await realRun(owner.id, w.at(2), 5, { inputs: false });
    await tick(w.at(1));
    await tick(w.at(49));
    expect((await checkOf(t.id, run.id))?.status).toBe('unverifiable');
    const decide = (by: Staff, decision: 'accept' | 'discard') => post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/${run.id}/decide`, { decision, reason: 'Vista a mano', password: by.password }, { cookie: by.cookie });
    expect((await decide(admin, 'accept')).json().error).toBe('staff_target');
    expect((await decide(admin, 'discard')).json().error).toBe('staff_target');
    expect((await decide(owner, 'accept')).json().error).toBe('tournament_self_accept');
    const ok = await decide(superadmin, 'accept');
    expect(ok.statusCode, ok.body).toBe(200);
    expect((ok.json() as AdminTournamentReview).canPublish).toBe(true);
    expect((await tick(w.at(50))).finished).toContain(t.id);
  });

  test('la consola del servidor decide la partida que nadie puede decidir en el panel, con su auditoría', async () => {
    const w = windowOf(15);
    const t = await scheduled(record(15, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    expect((await join(superadmin.cookie, t.id)).statusCode).toBe(200);
    const run = await realRun(superadmin.id, w.at(2), 5, { inputs: false });
    await tick(w.at(1));
    await tick(w.at(49));
    expect((await checkOf(t.id, run.id))?.status).toBe('unverifiable');
    const slug = (await tournamentById(app.db, t.id)).record.slug;
    const cli = async (argv: string[]) => {
      const lines: string[] = [];
      const code = await runCli(argv, { db: app.db, env: testEnv(), out: (x) => lines.push(x) });
      return { code, out: lines.join('\n') };
    };
    expect((await cli(['tournament-decide', slug, run.id, 'quizá', '--reason', 'Vista a mano'])).out).toContain('Uso: tournament-decide');
    expect((await cli(['tournament-decide', slug, run.id, 'accept'])).out).toContain('Uso: tournament-decide');
    const unknown = await cli(['tournament-decide', 'tc-no-existe', run.id, 'accept', '--reason', 'Vista a mano']);
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('No hay ningún torneo tc-no-existe');
    const done = await cli(['tournament-decide', slug, run.id, 'accept', '--reason', 'Vista a mano por la consola']);
    expect(done.code, done.out).toBe(0);
    expect(done.out).toContain('aceptada');
    expect(await checkOf(t.id, run.id)).toMatchObject({ decision: 'accept' });
    const audit = await app.db.selectFrom('galaxy.admin_audit_log').select(['actor_label', 'reason', 'after']).where('target_id', '=', t.id).where('action', '=', 'tournament.check_decided').execute();
    expect(audit).toEqual([{ actor_label: 'cli', reason: 'Vista a mano por la consola', after: { run: run.id, status: 'unverifiable', decision: 'accept' } }]);
    const again = await cli(['tournament-decide', slug, run.id, 'discard', '--reason', 'Otra vez']);
    expect(again.code).toBe(1);
    expect(again.out).toContain('ya está decidida');
    expect((await tick(w.at(50))).finished).toContain(t.id);
  });

  test('decidir en bloque las que no se pueden comprobar, por motivo o por jugador, saltando las que el admin no puede decidir', async () => {
    const w = windowOf(21);
    const t = await scheduled(record(21, { prizes: [{ from: 1, to: 4, gifts: [coins(10)] }], reviewHours: 0 }));
    const [a, b] = [await player('trbulka'), await player('trbulkb')];
    const playing = await staff('admin');
    const playingName = (await app.db.selectFrom('galaxy.accounts').select('username').where('id', '=', playing.id).executeTakeFirstOrThrow()).username;
    for (const x of [a, b, playing]) expect((await join(x.cookie, t.id)).statusCode).toBe(200);
    const a1 = await realRun(a.id, w.at(2), 6, { inputs: false });
    const a2 = await realRun(a.id, w.at(3), 6, { inputs: false });
    const b1 = await realRun(b.id, w.at(2), 5, { simVersion: '0.0.1' });
    const c1 = await realRun(playing.id, w.at(2), 4, { inputs: false });
    await tick(w.at(1));
    await tick(w.at(49));
    let r = await review(t.id);
    expect(Object.fromEntries(r.checks.map((c) => [c.runId, (c.detail as { reason?: string } | null)?.reason]))).toEqual({ [a1.id]: 'inputs_missing', [a2.id]: 'inputs_missing', [b1.id]: 'sim_version', [c1.id]: 'inputs_missing' });
    expect(r.unverifiable.byReason).toEqual(expect.arrayContaining([{ reason: 'inputs_missing', count: 3, blocking: 3 }, { reason: 'sim_version', count: 1, blocking: 1 }]));
    expect(r.unverifiable.byPlayer).toEqual(expect.arrayContaining([{ username: a.username, count: 2, blocking: 2 }, { username: playingName, count: 1, blocking: 1 }]));
    expect(r.blocking).toBe(4);

    const many = (body: object) => post(app.app, `/galaxy/api/admin/tournaments/${t.id}/checks/decide-many`, { reason: 'Revisadas en bloque', password: admin.password, ...body }, { cookie: admin.cookie });
    const first = await many({ decision: 'accept', filter: { reason: 'inputs_missing' } });
    expect(first.statusCode, first.body).toBe(200);
    const done = first.json() as TournamentDecideManyResult;
    expect(done.decided).toBe(2);
    expect(done.skipped).toEqual([{ runId: c1.id, username: playingName, why: 'staff_target' }]);
    const second = (await many({ decision: 'accept', filter: { username: b.username } })).json() as TournamentDecideManyResult;
    expect(second.decided).toBe(1);
    r = second;
    expect(r.blocking).toBe(1);
    expect(r.canPublish).toBe(false);
    const audit = await app.db.selectFrom('galaxy.admin_audit_log').select(['action', 'after']).where('target_id', '=', t.id).where('action', '=', 'tournament.checks_decided').orderBy('id').execute();
    expect(audit.map((x) => (x.after as { decided: number }).decided)).toEqual([2, 1]);
  });

  test('una comprobación de quien ya no está en los premios no frena los resultados', async () => {
    const w = windowOf(22);
    const t = await scheduled(record(22, { prizes: [{ from: 1, to: 1, gifts: [coins(100)] }], reviewHours: 0 }));
    const [x, y] = [await player('trstalex'), await player('trstaley')];
    for (const p of [x, y]) await join(p.cookie, t.id);
    const d = Math.max(1, playedRun(900).summary.depth);
    // x leads with a run that does not match and one without inputs; y, honest, is between what x had and what x keeps.
    await realRun(x.id, w.at(2), d + 5, { tamper: true });
    await realRun(x.id, w.at(3), d, { inputs: false });
    const honest = await realRun(y.id, w.at(4), d + 3);
    await tick(w.at(1));
    const end = await tick(w.at(49));
    expect((await checkOf(t.id, honest.id))?.status).toBe('ok');
    expect(end.finished).toContain(t.id);
    const winner = await app.db.selectFrom('galaxy.tournament_entries').select('rewards').where('tournament_id', '=', t.id).where('account_id', '=', y.id).executeTakeFirstOrThrow();
    expect(winner.rewards).toMatchObject({ place: 1 });
  });

  test('volver a admitir a un descalificado no lo deja en dos exclusivos que se solapan', async () => {
    const wa = windowOf(23);
    const a = await scheduled(record(23));
    const b = await scheduled(record(24, { startsAt: wa.startsAt, endsAt: wa.endsAt }));
    const p = await player('trrequal');
    expect((await join(p.cookie, a.id)).statusCode).toBe(200);
    const dq = (disqualified: boolean) => post(app.app, `/galaxy/api/admin/tournaments/${a.id}/entries/${p.username}/disqualify`, { disqualified, reason: 'Revisión', password: admin.password }, { cookie: admin.cookie });
    expect((await dq(true)).statusCode).toBe(200);
    expect((await join(p.cookie, b.id)).statusCode).toBe(200);
    const back = await dq(false);
    expect(back.statusCode).toBe(409);
    expect(back.json()).toMatchObject({ error: 'tournament_exclusive', slug: (await tournamentById(app.db, b.id)).record.slug });
  });

  test('quien está fuera de la clasificación no puede inscribirse', async () => {
    const t = await scheduled(record(25));
    const p = await player('trexcl');
    await app.db.updateTable('galaxy.accounts').set({ leaderboard_excluded: true }).where('id', '=', p.id).execute();
    const card = ((await get(app.app, '/galaxy/api/tournaments', { cookie: p.cookie })).json() as TournamentList).upcoming.find((c) => c.id === t.id)!;
    expect(card.join).toEqual({ open: false, block: 'excluded' });
    const res = await join(p.cookie, t.id);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('tournament_excluded');
  });

  test('el panel avisa cuando la simulación cambió desde que empezó un torneo', async () => {
    const w = windowOf(26);
    const t = await scheduled(record(26));
    const p = await player('trsim');
    await join(p.cookie, t.id);
    await tick(w.at(1));
    const one = async () => (await get(app.app, `/galaxy/api/admin/tournaments/${t.id}`, { cookie: admin.cookie })).json() as AdminTournament;
    expect(await one()).toMatchObject({ state: 'running', simVersion: SIM_VERSION, simChanged: false, simVersions: [] });
    await realRun(p.id, w.at(2), 3, { inputs: false });
    await app.db.updateTable('galaxy.tournaments').set({ started_sim_version: '0.0.1' }).where('id', '=', t.id).execute();
    expect(await one()).toMatchObject({ simVersion: '0.0.1', simChanged: true, simVersions: [SIM_VERSION] });
    const list = (await get(app.app, '/galaxy/api/admin/tournaments', { cookie: admin.cookie })).json() as AdminTournamentList;
    expect(list.simVersion).toBe(SIM_VERSION);
  });
});
