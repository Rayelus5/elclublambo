import { randomInt, randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type FinishRunRequest, generateGalaxy, type Leaderboard, type MeResponse, PROBE_TEST, type Profile, type PublicCollectionPage, type RunResult, type RunStart } from '@galaxy/shared';
import { encodeLog, SIM_VERSION, toBase64 } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { invalidateLeaderboard } from '../../src/social/leaderboard';
import { fixedConfig, get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The social side on the server (GDD §12.1, §14.1, §14.2; M5a): a finished run that is not suspicious gives account
// experience and, in an open season, points; the season leaderboard ranks players by score, depth and Cores; profiles
// and collections are public to anyone signed in and carry nothing private. Each block runs in its own season, on a
// random minute long past, so the runs other tests leave in the shared database never reach it.

type Ctx = Awaited<ReturnType<typeof testApp>>;

function season(extra: Record<string, unknown> = {}) {
  // In the past (sessions are read against the app's clock but expire by the database's, so a future clock signs out),
  // on a random minute of 30 years with a three-day window: a season never meets the runs an earlier run of this file
  // left in the shared database.
  const startsAt = new Date(Date.UTC(1990, 0, 1) + randomInt(30 * 365 * 24 * 60) * 60_000);
  const endsAt = new Date(startsAt.getTime() + 3 * 86_400_000);
  return { id: `test-${randomInt(1_000_000)}`, name: 'Temporada de prueba', startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), ...extra };
}
const at = (s: { startsAt: string }, hours: number) => new Date(Date.parse(s.startsAt) + hours * 3_600_000);

async function player(ctx: Ctx, prefix = 'soc') {
  const username = uniqueName(prefix);
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id, username };
}

/** A finished run straight into the table (what finishRun leaves), at `when`. */
async function scored(ctx: Ctx, account: string, run: { depth: number; bossKills: number; outcome: 'extracted' | 'died'; when: Date; suspicious?: boolean }) {
  await ctx.db
    .insertInto('galaxy.runs')
    .values({
      account_id: account,
      seed: '1',
      sector: 'outer-nebula',
      probe: 'lumen',
      relics: '[]',
      content_version: 0,
      sim_version: SIM_VERSION,
      start_key: randomUUID(),
      started_at: new Date(run.when.getTime() - 600_000),
      finished_at: run.when,
      outcome: run.outcome,
      ticks: 36_000,
      depth: run.depth,
      kills: 100,
      boss_kills: run.bossKills,
      level: 10,
      seconds: 600,
      hash: '0123456789abcdef',
      payout: '{}',
      runs_version: 0,
      flags: run.suspicious ? ['kills_rate'] : [],
      suspicious: run.suspicious ?? false,
    })
    .execute();
}

let seedCounter = 1n;
async function own(ctx: Ctx, owner: string, tier: number, finish = 'normal'): Promise<string> {
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 31n + seedCounter++, tier);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier, score: g.score, finish, origin: 'grant' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const board = async (ctx: Ctx, cookie: string, tab = 'general') => (await get(ctx.app, `/galaxy/api/leaderboard?tab=${tab}`, { cookie })).json() as Leaderboard;

describe('la experiencia de una incursión', () => {
  const s = season();
  let clock = at(s, 24);
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await testApp({ now: () => clock, config: fixedConfig({ season: s }) });
  });
  afterAll(() => ctx.close());

  const INPUTS = toBase64(encodeLog({ probes: 1, events: [1, 0, 0, 127, 0, -1, 300, 0, 0, 0, 0, -1] }));
  const body = (over: Partial<FinishRunRequest> = {}): FinishRunRequest => ({
    outcome: 'extracted',
    ticks: 6 * 3600,
    depth: 1,
    kills: 600,
    bossKills: 1,
    level: 14,
    loot: [{ coins: 40, dust: 12 }],
    hash: '0123456789abcdef',
    inputs: INPUTS,
    ...over,
  });
  async function play(cookie: string, finishBody: FinishRunRequest): Promise<RunResult> {
    const start = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(start.statusCode).toBe(200);
    clock = new Date(clock.getTime() + 10 * 60_000);
    const res = await post(ctx.app, `/galaxy/api/runs/${(start.json() as RunStart).id}/finish`, finishBody, { cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(res.statusCode).toBe(200);
    return res.json() as RunResult;
  }

  test('una incursión terminada da experiencia y puntos, sube de nivel y el nivel llega a /auth/me', async () => {
    const p = await player(ctx);
    expect(((await get(ctx.app, '/galaxy/api/auth/me', { cookie: p.cookie })).json() as MeResponse).level).toBe(1);
    const result = await play(p.cookie, body());
    // Six minutes of ticks (60), a layer (15), a Core (40) and the extraction (30); 10 + 50 + 25 points.
    expect(result.progress).toEqual({ xp: 145, level: 2, levelUp: true, points: 85 });
    expect(((await get(ctx.app, '/galaxy/api/auth/me', { cookie: p.cookie })).json() as MeResponse).level).toBe(2);
    const row = await ctx.db.selectFrom('galaxy.account_xp').select('xp').where('account_id', '=', p.id).executeTakeFirstOrThrow();
    expect(Number(row.xp)).toBe(145);
  });

  test('terminar una incursión refresca la clasificación al momento, sin esperar a la caché', async () => {
    const p = await player(ctx);
    expect((await board(ctx, p.cookie)).me).toBeNull();
    await play(p.cookie, body());
    expect((await board(ctx, p.cookie)).me).toMatchObject({ username: p.username, value: 85 });
  });

  test('empezar y morir enseguida no da experiencia ni puntos (revisión M5a)', async () => {
    const p = await player(ctx);
    const quick = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    clock = new Date(clock.getTime() + 2000);
    const res = await post(
      ctx.app,
      `/galaxy/api/runs/${(quick.json() as RunStart).id}/finish`,
      body({ outcome: 'died', ticks: 60, depth: 1, kills: 0, bossKills: 0, loot: [{ coins: 0, dust: 0 }], inputs: toBase64(encodeLog({ probes: 1, events: [] })) }),
      { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } },
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as RunResult).progress).toEqual({ xp: 0, level: 1, levelUp: false, points: 0 });
    expect((await board(ctx, p.cookie)).me).toBeNull();
  });

  test('una incursión sospechosa no da experiencia ni puntos', async () => {
    const p = await player(ctx);
    const loot = Array.from({ length: 999 }, () => ({ coins: 40, dust: 12 }));
    const result = await play(p.cookie, body({ ticks: 60 * 60, depth: 999, kills: 10_000_000, bossKills: 999, loot, inputs: toBase64(encodeLog({ probes: 1, events: [] })) }));
    expect(result.progress).toEqual({ xp: 0, level: 1, levelUp: false, points: 0 });
    const row = await ctx.db.selectFrom('galaxy.account_xp').select('xp').where('account_id', '=', p.id).executeTakeFirst();
    expect(Number(row?.xp ?? 0)).toBe(0);
  });
});

describe('la clasificación de la temporada', () => {
  const s = season({ top: 3 });
  const clock = at(s, 40);
  let ctx: Ctx;
  let a: Awaited<ReturnType<typeof player>>;
  let b: typeof a;
  let c: typeof a;
  let d: typeof a;
  let cheat: typeof a;
  let early: typeof a;
  beforeAll(async () => {
    ctx = await testApp({ now: () => clock, config: fixedConfig({ season: s }) });
    [a, b, c, d, cheat, early] = [await player(ctx, 'lba'), await player(ctx, 'lbb'), await player(ctx, 'lbc'), await player(ctx, 'lbd'), await player(ctx, 'lbx'), await player(ctx, 'lbe')];
    // A and C tie on 175 points and depth 5 with two Cores; C got there first. B leads with 180; D has 10.
    await scored(ctx, a.id, { depth: 5, bossKills: 2, outcome: 'extracted', when: at(s, 30) });
    await scored(ctx, b.id, { depth: 3, bossKills: 3, outcome: 'died', when: at(s, 20) });
    await scored(ctx, c.id, { depth: 5, bossKills: 2, outcome: 'extracted', when: at(s, 10) });
    await scored(ctx, d.id, { depth: 1, bossKills: 0, outcome: 'died', when: at(s, 5) });
    await scored(ctx, cheat.id, { depth: 99, bossKills: 50, outcome: 'extracted', when: at(s, 6), suspicious: true });
    await scored(ctx, early.id, { depth: 9, bossKills: 9, outcome: 'extracted', when: at(s, -1) });
    await ctx.db.insertInto('galaxy.account_xp').values({ account_id: a.id, xp: 1000 }).execute();
    invalidateLeaderboard();
  });
  afterAll(() => ctx.close());

  test('la general: por puntos, los empates comparten puesto y va antes quien llegó antes', async () => {
    const v = await board(ctx, a.cookie);
    expect(v.season).toEqual({ id: s.id, name: s.name, startsAt: s.startsAt, endsAt: s.endsAt, tiers: [500, 2000, 6000, 15000, 30000] });
    expect(v.tab).toBe('general');
    expect(v.rows).toEqual([
      { rank: 1, username: b.username, level: 1, value: 180 },
      { rank: 2, username: c.username, level: 1, value: 175 },
      { rank: 2, username: a.username, level: 5, value: 175 },
    ]);
    expect(v.me).toEqual({ rank: 2, username: a.username, level: 5, value: 175 });
    expect(v.total).toBe(4);
  });

  test('tu fila sale aunque estés fuera del top, y sin puntos no hay fila', async () => {
    expect((await board(ctx, d.cookie)).me).toEqual({ rank: 4, username: d.username, level: 1, value: 10 });
    expect((await board(ctx, early.cookie)).me).toBeNull();
    expect((await board(ctx, cheat.cookie)).me).toBeNull();
  });

  test('profundidad y purgas tienen su propio orden', async () => {
    const depth = await board(ctx, d.cookie, 'depth');
    expect(depth.rows.map((r) => [r.rank, r.username, r.value])).toEqual([
      [1, c.username, 5],
      [1, a.username, 5],
      [3, b.username, 3],
    ]);
    expect(depth.me).toMatchObject({ rank: 4, value: 1 });
    const purges = await board(ctx, d.cookie, 'purges');
    expect(purges.rows.map((r) => [r.rank, r.username, r.value])).toEqual([
      [1, b.username, 3],
      [2, c.username, 2],
      [2, a.username, 2],
    ]);
    // No Cores, no row.
    expect(purges.me).toBeNull();
    expect(purges.total).toBe(3);
  });

  test('una pestaña que no existe no vale y sin sesión no hay clasificación', async () => {
    expect((await get(ctx.app, '/galaxy/api/leaderboard?tab=amigos', { cookie: a.cookie })).statusCode).toBe(400);
    expect((await get(ctx.app, '/galaxy/api/leaderboard')).statusCode).toBe(401);
  });

  test('el perfil público: nivel, temporada, récords, colección y planetario, nada privado', async () => {
    const legend = await own(ctx, a.id, 4, 'holo');
    await own(ctx, a.id, 2);
    const gone = await own(ctx, a.id, 0);
    await ctx.db.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', '=', gone).execute();
    await put(ctx.app, '/galaxy/api/planetarium/exhibits', { galaxies: [legend] }, { cookie: a.cookie });

    const res = await get(ctx.app, `/galaxy/api/profiles/${a.username.toUpperCase()}`, { cookie: b.cookie });
    expect(res.statusCode).toBe(200);
    const p = res.json() as Profile;
    expect(Object.keys(p).sort()).toEqual(['clan', 'collection', 'level', 'planetarium', 'records', 'season', 'since', 'username']);
    expect(p.clan).toBeNull();
    expect(p.username).toBe(a.username);
    expect(p.level).toBe(5);
    expect(Date.parse(p.since)).not.toBeNaN();
    expect(p.season).toEqual({ score: 175, rank: 2, tier: null, maxDepth: 5, purges: 2, extractions: 1 });
    expect(p.records).toEqual({ maxDepth: 5, purges: 2, runs: 1 });
    expect(p.collection).toEqual({ total: 2, counts: { common: 0, uncommon: 0, rare: 1, epic: 0, legendary: 1 } });
    expect(p.planetarium).toMatchObject({ prestige: 13, exhibits: 1, cover: { id: legend, tier: 'legendary', finish: 'holo' } });
    expect(Object.keys(p.planetarium.cover!).sort()).toEqual(['designation', 'featured', 'finish', 'id', 'level', 'name', 'seed', 'tier', 'traits']);

    // Without points in the season there is no season block; the records still count everything.
    const early_ = (await get(ctx.app, `/galaxy/api/profiles/${early.username}`, { cookie: b.cookie })).json() as Profile;
    expect(early_.season).toBeNull();
    expect(early_.records).toEqual({ maxDepth: 9, purges: 9, runs: 1 });

    const missing = await get(ctx.app, '/galaxy/api/profiles/nadie_por_aqui_zz', { cookie: b.cookie });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'profile_not_found' });
    expect((await get(ctx.app, `/galaxy/api/profiles/${a.username}`)).statusCode).toBe(401);
  });

  test('la colección pública: solo lo público, por rareza, filtrada y paginada', async () => {
    const owner = await player(ctx, 'col');
    await own(ctx, owner.id, 4);
    await own(ctx, owner.id, 2);
    await own(ctx, owner.id, 2);
    const gone = await own(ctx, owner.id, 3);
    await ctx.db.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', '=', gone).execute();

    const all = (await get(ctx.app, `/galaxy/api/profiles/${owner.username}/galaxies`, { cookie: b.cookie })).json() as PublicCollectionPage;
    expect(all.items.map((g) => g.tier)).toEqual(['legendary', 'rare', 'rare']);
    expect(Object.keys(all.items[0]!).sort()).toEqual(['designation', 'featured', 'finish', 'id', 'level', 'name', 'seed', 'tier', 'traits']);
    expect(all.counts).toEqual({ common: 0, uncommon: 0, rare: 2, epic: 0, legendary: 1 });
    expect(all.next).toBeUndefined();

    const rare = (await get(ctx.app, `/galaxy/api/profiles/${owner.username}/galaxies?tier=rare`, { cookie: b.cookie })).json() as PublicCollectionPage;
    expect(rare.items).toHaveLength(2);
    const first = (await get(ctx.app, `/galaxy/api/profiles/${owner.username}/galaxies?limit=2`, { cookie: b.cookie })).json() as PublicCollectionPage;
    expect(first.items).toHaveLength(2);
    const rest = (await get(ctx.app, `/galaxy/api/profiles/${owner.username}/galaxies?limit=2&cursor=${encodeURIComponent(first.next!)}`, { cookie: b.cookie })).json() as PublicCollectionPage;
    expect(rest.items.map((g) => g.tier)).toEqual(['rare']);

    expect((await get(ctx.app, '/galaxy/api/profiles/nadie_por_aqui_zz/galaxies', { cookie: b.cookie })).statusCode).toBe(404);
  });
});

test('sin temporada abierta, la clasificación lo dice y no tiene filas', async () => {
  const s = season();
  const ctx = await testApp({ now: () => at(s, -24), config: fixedConfig({ season: s }) });
  try {
    const p = await player(ctx);
    const v = await board(ctx, p.cookie);
    expect(v).toEqual({ season: null, tab: 'general', rows: [], me: null, total: 0 });
  } finally {
    await ctx.close();
  }
});
