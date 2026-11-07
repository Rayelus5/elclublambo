import { randomUUID } from 'node:crypto';
import { type HangarView, PROBE_TEST, type ProbeTestResult } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { get, post, put, sessionCookie, testApp, uniqueName } from '../helpers';

// The probe test and the unlocks on the server (GDD §6): the test is scored and kept once, gives the starting probe
// and picks it in the hangar; the other probes unlock with the stats of finished, non-suspicious runs.

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  ctx = await testApp();
});
afterAll(() => ctx.close());

async function player() {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('prb'), password: 'una-clave-larga' });
  return { cookie: sessionCookie(res), id: (res.json() as { id: string }).id };
}
const answersFor = (probe: string) => PROBE_TEST.questions.map((q) => q.answers.indexOf(probe as never));
const takeTest = (cookie: string, answers: number[]) => post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie });
const hangar = async (cookie: string) => (await get(ctx.app, '/galaxy/api/hangar', { cookie })).json() as HangarView;
const choose = (cookie: string, probe: string) => put(ctx.app, '/galaxy/api/hangar/probe', { probe }, { cookie });

/** Finished runs straight in the table (what finishRun would leave). */
async function finishedRuns(
  account: string,
  n: number,
  over: { boss_kills?: number; depth?: number; outcome?: 'extracted' | 'died'; kills?: number; suspicious?: boolean; seconds?: number; finished?: boolean } = {},
) {
  const done = over.finished ?? true;
  for (let k = 0; k < n; k++) {
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
        started_at: new Date(),
        finished_at: done ? new Date() : null,
        outcome: done ? (over.outcome ?? 'died') : null,
        ticks: 600,
        depth: over.depth ?? 1,
        kills: over.kills ?? 10,
        boss_kills: over.boss_kills ?? 0,
        level: 3,
        seconds: over.seconds ?? 120,
        hash: '0123456789abcdef',
        payout: '{}',
        runs_version: 0,
        flags: over.suspicious ? ['too_fast'] : [],
        suspicious: over.suspicious ?? false,
      })
      .execute();
  }
}

test('las partidas de menos de un minuto o sin terminar no cuentan para los desbloqueos', async () => {
  const { cookie, id } = await player();
  await takeTest(cookie, answersFor('lumen'));
  // Three runs abandoned in seconds, and three never finished: none of them is playing.
  await finishedRuns(id, 3, { seconds: 30 });
  await finishedRuns(id, 3, { finished: false });
  expect((await hangar(cookie)).probes.find((p) => p.id === 'bastion')).toMatchObject({ unlocked: false, progress: 0 });
  await finishedRuns(id, 3, { seconds: 60 });
  expect((await hangar(cookie)).probes.find((p) => p.id === 'bastion')).toMatchObject({ unlocked: true });
});

test('el test asigna la sonda, la guarda y la elige en el Hangar', async () => {
  const { cookie } = await player();
  expect((await hangar(cookie)).test).toEqual({ taken: false, probe: null });
  const res = await takeTest(cookie, answersFor('bastion'));
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ probe: 'bastion' } satisfies ProbeTestResult);
  const view = await hangar(cookie);
  expect(view.test).toEqual({ taken: true, probe: 'bastion' });
  expect(view.probe).toBe('bastion');
  expect(view.probes).toHaveLength(8);
  expect(view.probes.find((p) => p.id === 'bastion')).toMatchObject({ unlocked: true, condition: null, progress: 1 });
  expect(view.probes.find((p) => p.id === 'lumen')).toMatchObject({ unlocked: false, condition: { stat: 'runs', value: 3 }, progress: 0 });
  expect(view.probes.find((p) => p.id === 'sentinel')).toMatchObject({ unlocked: false, condition: { stat: 'bossKills', value: 3 } });
});

test('un segundo envío devuelve el primer resultado, nunca otro', async () => {
  const { cookie } = await player();
  await takeTest(cookie, answersFor('spark'));
  const again = await takeTest(cookie, answersFor('lumen'));
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual({ probe: 'spark' });
  expect((await hangar(cookie)).probe).toBe('spark');
});

test('un empate sin la pregunta de desempate da 400 tiebreak_required; con ella, vale', async () => {
  const { cookie } = await player();
  const q = PROBE_TEST.questions;
  const tie = [q[0]!.answers.indexOf('lumen'), q[1]!.answers.indexOf('lumen'), q[2]!.answers.indexOf('bastion'), q[3]!.answers.indexOf('bastion'), q[4]!.answers.indexOf('spark')];
  const res = await takeTest(cookie, tie);
  expect(res.statusCode).toBe(400);
  expect(res.json()).toEqual({ error: 'tiebreak_required' });
  const ok = await takeTest(cookie, [...tie, PROBE_TEST.tiebreak.answers.indexOf('lumen')]);
  expect(ok.json()).toEqual({ probe: 'lumen' });
});

test('respuestas rotas: 400, sin guardar nada', async () => {
  const { cookie } = await player();
  for (const answers of [[0, 1], [0, 1, 2, 0, 9], ['a', 0, 0, 0, 0]]) {
    const res = await post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie });
    expect(res.statusCode).toBe(400);
  }
  expect((await hangar(cookie)).test.taken).toBe(false);
});

test('elegir una sonda bloqueada da 409; desbloqueada, vale; las partidas sospechosas no cuentan', async () => {
  const { cookie, id } = await player();
  await takeTest(cookie, answersFor('lumen'));
  const locked = await choose(cookie, 'sentinel');
  expect(locked.statusCode).toBe(409);
  expect(locked.json()).toEqual({ error: 'probe_locked' });
  await finishedRuns(id, 3, { boss_kills: 1, suspicious: true });
  expect((await choose(cookie, 'sentinel')).statusCode).toBe(409);
  await finishedRuns(id, 3, { boss_kills: 1 });
  const ok = await choose(cookie, 'sentinel');
  expect(ok.statusCode).toBe(200);
  expect((ok.json() as HangarView).probe).toBe('sentinel');
  expect((await choose(cookie, 'nope')).statusCode).toBe(400);
  // Three finished runs also unlock the other two starters.
  expect((await hangar(cookie)).probes.find((p) => p.id === 'spark')).toMatchObject({ unlocked: true });
});

test('sin test no se elige sonda ni se empieza una incursión: 409 probe_test_required', async () => {
  const { cookie } = await player();
  expect((await choose(cookie, 'lumen')).json()).toEqual({ error: 'probe_test_required' });
  const start = await post(
    ctx.app,
    '/galaxy/api/runs',
    { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION },
    { cookie, headers: { 'idempotency-key': randomUUID() } },
  );
  expect(start.statusCode).toBe(409);
  expect(start.json()).toEqual({ error: 'probe_test_required' });
  await takeTest(cookie, answersFor('lumen'));
  const again = await post(
    ctx.app,
    '/galaxy/api/runs',
    { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION },
    { cookie, headers: { 'idempotency-key': randomUUID() } },
  );
  expect(again.statusCode).toBe(200);
});
