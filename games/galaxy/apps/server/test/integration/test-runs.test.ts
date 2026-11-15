import { randomUUID } from 'node:crypto';
import { type AdminRunList, type AdminStats, type FinishRunRequest, PROBE_TEST, type Role, type RunResult, type RunStart, type Wallet } from '@galaxy/shared';
import { encodeLog, SIM_VERSION, toBase64 } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAdminViaCli, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Test runs of the admin debug mode (2026-11-15): an admin's solo run becomes a test run when the debug menu changes
// play (POST /runs/:id/test) or starts as one (a content draft, POST /runs with test). A test run pays nothing, counts
// for nothing (season, missions, ranking, unlocks, the panel's statistics) and leaves an audit trace.

let clock = new Date(Date.now() - 3_600_000);
type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

const answers = PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never));

async function player() {
  const username = uniqueName('tst');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie });
  return { cookie, username, id: (res.json() as { id: string }).id };
}

async function staff(role: Role) {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret, clock) });
  expect(res.statusCode).toBe(200);
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers }, { cookie });
  const id = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;
  return { cookie, username, id };
}

const start = (cookie: string, test?: true) =>
  post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION, ...(test ? { test } : {}) }, { cookie, headers: { 'idempotency-key': randomUUID() } });
const markTest = (cookie: string, id: string) => post(ctx.app, `/galaxy/api/runs/${id}/test`, {}, { cookie });
const finish = (cookie: string, id: string, body: FinishRunRequest) => post(ctx.app, `/galaxy/api/runs/${id}/finish`, body, { cookie, headers: { 'idempotency-key': randomUUID() } });
const wallet = async (cookie: string) => (await get(ctx.app, '/galaxy/api/gacha', { cookie })).json().wallet as Wallet;
const row = (id: string) => ctx.db.selectFrom('galaxy.runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const audits = (id: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'reason', 'actor_id']).where('target_id', '=', id).orderBy('id').execute();

const INPUTS = toBase64(encodeLog({ probes: 1, events: [1, 0, 0, 127, 0, -1] }));
const body = (over: Partial<FinishRunRequest> = {}): FinishRunRequest => ({
  outcome: 'extracted',
  ticks: 6 * 3600,
  depth: 2,
  kills: 900,
  bossKills: 1,
  level: 20,
  loot: [{ coins: 40, dust: 12 }, { coins: 30, dust: 9 }],
  hash: '0123456789abcdef',
  inputs: INPUTS,
  ...over,
});

/** Everything a paid run would have touched for this account: wallet, the day's run time, experience and the ledger. */
async function trail(accountId: string, cookie: string, runId: string) {
  const days = await ctx.db.selectFrom('galaxy.run_days').select('seconds').where('account_id', '=', accountId).execute();
  const xp = await ctx.db.selectFrom('galaxy.account_xp').select('xp').where('account_id', '=', accountId).executeTakeFirst();
  const ledger = await ctx.db.selectFrom('galaxy.ledger').select('id').where('account_id', '=', accountId).execute();
  const inputs = await ctx.db.selectFrom('galaxy.run_inputs').select('run_id').where('run_id', '=', runId).execute();
  return { wallet: await wallet(cookie), days: days.map((d) => Number(d.seconds)), xp: Number(xp?.xp ?? 0), ledger: ledger.length, inputs: inputs.length };
}

let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
});

describe('quién puede', () => {
  test('empezar de prueba o marcar una incursión pide admin con doble factor', async () => {
    const p = await player();
    expect((await start(p.cookie, true)).statusCode).toBe(403);
    const mod = await staff('moderator');
    expect((await start(mod.cookie, true)).statusCode).toBe(403);
    // An admin role without a TOTP session (the role given to an account already logged in) is not enough.
    await ctx.db.insertInto('galaxy.account_roles').values({ account_id: p.id, role: 'admin' }).execute();
    expect((await start(p.cookie, true)).statusCode).toBe(403);
    const run = (await start(p.cookie)).json() as RunStart;
    expect((await markTest(p.cookie, run.id)).statusCode).toBe(403);
  });
});

describe('empezar de prueba', () => {
  test('la fila nace marcada y queda en la auditoría', async () => {
    const res = await start(admin.cookie, true);
    expect(res.statusCode).toBe(200);
    const run = res.json() as RunStart;
    const r = await row(run.id);
    expect(r.flags).toContain('debug');
    expect(r.suspicious).toBe(true);
    expect(await audits(run.id)).toEqual([{ action: 'run.test', reason: 'draft', actor_id: admin.id }]);
  });
});

describe('marcar una incursión empezada', () => {
  test('marca una vez, aunque se pida dos, y solo la propia, en solitario y sin terminar', async () => {
    const run = (await start(admin.cookie)).json() as RunStart;
    const first = await markTest(admin.cookie, run.id);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ id: run.id, test: true });
    expect((await markTest(admin.cookie, run.id)).statusCode).toBe(200);
    expect(await audits(run.id)).toEqual([{ action: 'run.test', reason: 'debug', actor_id: admin.id }]);
    const r = await row(run.id);
    expect(r.flags.filter((f) => f === 'debug')).toHaveLength(1);
    expect(r.suspicious).toBe(true);

    const p = await player();
    const theirs = (await start(p.cookie)).json() as RunStart;
    expect((await markTest(admin.cookie, theirs.id)).statusCode).toBe(404);
    expect((await markTest(admin.cookie, randomUUID())).statusCode).toBe(404);

    const done = (await start(admin.cookie)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    expect((await finish(admin.cookie, done.id, body())).statusCode).toBe(200);
    expect((await markTest(admin.cookie, done.id)).statusCode).toBe(409);
  });
});

describe('terminar una incursión de prueba', () => {
  test('no paga nada ni deja rastro de paga, y la fila queda cerrada y marcada', async () => {
    const run = (await start(admin.cookie)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    expect((await markTest(admin.cookie, run.id)).statusCode).toBe(200);
    const before = await trail(admin.id, admin.cookie, run.id);
    const res = await finish(admin.cookie, run.id, body({ test: true }));
    expect(res.statusCode).toBe(200);
    const r = res.json() as RunResult;
    expect(r.test).toBe(true);
    expect(r.payout).toEqual({ coins: 0, dust: 0, signals: 0, material: 0, components: 0, satellites: 0 });
    expect(r.progress).toMatchObject({ xp: 0, levelUp: false, points: 0 });
    expect(await trail(admin.id, admin.cookie, run.id)).toEqual(before);
    const kept = await row(run.id);
    expect(kept.finished_at).not.toBeNull();
    expect(kept.outcome).toBe('extracted');
    expect(kept.depth).toBe(2);
    expect(kept.flags).toContain('debug');
    expect(kept.suspicious).toBe(true);
  });

  test('fila marcada sin test en el cuerpo no paga', async () => {
    const run = (await start(admin.cookie)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    await markTest(admin.cookie, run.id);
    const before = await trail(admin.id, admin.cookie, run.id);
    const r = (await finish(admin.cookie, run.id, body())).json() as RunResult;
    expect(r.test).toBe(true);
    expect(await trail(admin.id, admin.cookie, run.id)).toEqual(before);
  });

  test('finish de un no admin con test=true no paga', async () => {
    const p = await player();
    const run = (await start(p.cookie)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    const before = await trail(p.id, p.cookie, run.id);
    const res = await finish(p.cookie, run.id, body({ test: true }));
    expect(res.statusCode).toBe(200);
    expect((res.json() as RunResult).test).toBe(true);
    expect(await trail(p.id, p.cookie, run.id)).toEqual(before);
    expect((await row(run.id)).flags).toContain('debug');
  });

  test('una incursión normal sigue pagando como siempre', async () => {
    const p = await player();
    const run = (await start(p.cookie)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    const r = (await finish(p.cookie, run.id, body())).json() as RunResult;
    expect(r.test).toBeUndefined();
    expect(r.payout.coins).toBeGreaterThan(0);
  });
});

describe('el panel', () => {
  test('las estadísticas no cuentan las incursiones de prueba', async () => {
    const stats = async () => (await get(ctx.app, '/galaxy/api/admin/stats?period=24h', { cookie: admin.cookie })).json() as AdminStats;
    const total = (s: AdminStats) => s.runs.buckets.reduce((a, b) => a + b.count, 0);
    const before = await stats();
    const run = (await start(admin.cookie, true)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    await finish(admin.cookie, run.id, body());
    const after = await stats();
    expect(total(after)).toBe(total(before));
    expect(after.runs.outcomes).toEqual(before.runs.outcomes);
  });

  test('la lista de sospechosas las deja fuera y no se pueden desmarcar', async () => {
    const run = (await start(admin.cookie, true)).json() as RunStart;
    clock = new Date(clock.getTime() + 13 * 60_000);
    await finish(admin.cookie, run.id, body());
    const all = (await get(ctx.app, `/galaxy/api/admin/runs?player=${admin.username}`, { cookie: admin.cookie })).json() as AdminRunList;
    expect(all.runs.find((r) => r.id === run.id)?.flags).toContain('debug');
    const flagged = (await get(ctx.app, `/galaxy/api/admin/runs?player=${admin.username}&suspicious=true`, { cookie: admin.cookie })).json() as AdminRunList;
    expect(flagged.runs.some((r) => r.id === run.id)).toBe(false);
    const res = await post(ctx.app, `/galaxy/api/admin/runs/${run.id}/mark`, { suspicious: false, reason: 'Era buena' }, { cookie: admin.cookie });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('run_test');
  });
});
