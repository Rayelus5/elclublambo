import { randomUUID } from 'node:crypto';
import { type HangarView, parseConfig, PROBE_TEST } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createConfigService } from '../../src/config/service';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// Sectors on the server (GDD §5.5, §13.1): the hangar keeps the chosen sector, shows which are open and what opens the
// rest, and a run only starts in an open sector. The season sector is open while it is the live config's season.

let ctx: Awaited<ReturnType<typeof testApp>>;
/** Apps whose live config `sectors` is overridden (the database's config is the user's: never published to here). */
const withSectors = async (sectors: unknown) => {
  const real = createConfigService(ctx.db);
  const fixed = parseConfig('sectors', sectors);
  return testApp({ config: { ...real, get: ((key: string) => (key === 'sectors' ? Promise.resolve(fixed) : real.get(key as never))) as typeof real.get } });
};
let closed: Awaited<ReturnType<typeof testApp>>;
let broken: Awaited<ReturnType<typeof testApp>>;
let wrong: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  ctx = await testApp();
  closed = await withSectors({ season: null });
  broken = await withSectors({ season: 'no-such-sector' });
  wrong = await withSectors({ season: 'frost-rings' });
});
afterAll(async () => {
  await Promise.all([closed.close(), broken.close(), wrong.close()]);
  await ctx.close();
});

async function player(app = ctx.app) {
  const res = await post(app, '/galaxy/api/auth/register', { username: uniqueName('sec'), password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  // The probe test comes first (M3b-2): no run without it.
  await post(app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id: (res.json() as { id: string }).id };
}
const hangar = async (cookie: string, app = ctx.app) => (await get(app, '/galaxy/api/hangar', { cookie })).json() as HangarView;
const choose = (cookie: string, sector: string, app = ctx.app) => put(app, '/galaxy/api/hangar/sector', { sector }, { cookie });
const start = (cookie: string, sector: string, app = ctx.app) =>
  post(app, '/galaxy/api/runs', { sector, probe: 'lumen', simVersion: SIM_VERSION }, { cookie, headers: { 'idempotency-key': randomUUID() } });

/** A finished run straight in the table (what finishRun would leave). */
async function finishedRun(account: string, sector: string, over: { boss_kills?: number; suspicious?: boolean; finished?: boolean } = {}) {
  const done = over.finished ?? true;
  await ctx.db
    .insertInto('galaxy.runs')
    .values({
      account_id: account,
      seed: '1',
      sector,
      probe: 'lumen',
      relics: '[]',
      content_version: 0,
      sim_version: SIM_VERSION,
      start_key: randomUUID(),
      started_at: new Date(),
      finished_at: done ? new Date() : null,
      outcome: done ? 'died' : null,
      ticks: 18_000,
      depth: 1,
      kills: 100,
      boss_kills: over.boss_kills ?? 0,
      level: 8,
      seconds: 300,
      hash: '0123456789abcdef',
      payout: '{}',
      runs_version: 0,
      flags: over.suspicious ? ['too_fast'] : [],
      suspicious: over.suspicious ?? false,
    })
    .execute();
}

test('un hangar nuevo: la Nebulosa elegida, los 5 sectores, la Escarcha cerrada con su condición y la temporada abierta', async () => {
  const { cookie } = await player();
  const h = await hangar(cookie);
  expect(h.sector).toBe('outer-nebula');
  expect(h.sectors.map((s) => s.id)).toEqual(['outer-nebula', 'frost-rings', 'hollow-reef', 'broken-forge', 'signal-rift']);
  expect(h.sectors.find((s) => s.id === 'outer-nebula')).toMatchObject({ unlocked: true, season: false, biome: 'nebula' });
  expect(h.sectors.find((s) => s.id === 'frost-rings')).toMatchObject({
    unlocked: false,
    condition: { sector: 'outer-nebula', stat: 'bossKills', value: 1 },
    progress: 0,
    biome: 'ice',
  });
  expect(h.sectors.find((s) => s.id === 'signal-rift')).toMatchObject({ unlocked: true, season: true, condition: null });
});

test('vencer al Núcleo de la Nebulosa abre la Escarcha; una partida sospechosa o sin terminar no cuenta', async () => {
  const { cookie, id } = await player();
  const locked = await choose(cookie, 'frost-rings');
  expect(locked.statusCode).toBe(409);
  expect(locked.json()).toEqual({ error: 'sector_locked' });
  await finishedRun(id, 'outer-nebula', { boss_kills: 1, suspicious: true });
  await finishedRun(id, 'outer-nebula', { boss_kills: 1, finished: false });
  // A Core beaten in another sector does not open this one.
  await finishedRun(id, 'signal-rift', { boss_kills: 3 });
  expect((await choose(cookie, 'frost-rings')).statusCode).toBe(409);
  await finishedRun(id, 'outer-nebula', { boss_kills: 1 });
  const ok = await choose(cookie, 'frost-rings');
  expect(ok.statusCode).toBe(200);
  expect((ok.json() as HangarView).sector).toBe('frost-rings');
  expect((await hangar(cookie)).sector).toBe('frost-rings');
  expect((await choose(cookie, 'nope')).statusCode).toBe(400);
});

test('una incursión solo empieza en un sector abierto', async () => {
  const { cookie } = await player();
  const locked = await start(cookie, 'broken-forge');
  expect(locked.statusCode).toBe(409);
  expect(locked.json()).toEqual({ error: 'sector_locked' });
  expect((await start(cookie, 'nope')).statusCode).toBe(400);
  expect((await start(cookie, 'signal-rift')).statusCode).toBe(200);
});

test('sin temporada abierta: quien la tenía elegida vuelve a la Nebulosa, la Fisura no deja empezar y la Nebulosa sí', async () => {
  const { cookie } = await player();
  expect((await choose(cookie, 'signal-rift')).statusCode).toBe(200);
  const h = await hangar(cookie, closed.app);
  expect(h.sector).toBe('outer-nebula');
  expect(h.sectors.find((s) => s.id === 'signal-rift')).toMatchObject({ unlocked: false, season: true, condition: null });
  expect((await start(cookie, 'signal-rift', closed.app)).statusCode).toBe(409);
  expect((await start(cookie, 'outer-nebula', closed.app)).statusCode).toBe(200);
});

test('una temporada que apunta a un sector inexistente o normal no rompe el Hangar ni abre nada', async () => {
  for (const app of [broken.app, wrong.app]) {
    const { cookie } = await player(app);
    const h = await hangar(cookie, app);
    expect(h.sectors).toHaveLength(5);
    expect(h.sectors.find((s) => s.id === 'signal-rift')).toMatchObject({ unlocked: false });
    expect(h.sectors.find((s) => s.id === 'frost-rings')).toMatchObject({ unlocked: false });
    expect((await start(cookie, 'outer-nebula', app)).statusCode).toBe(200);
  }
});
