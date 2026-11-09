import { randomUUID } from 'node:crypto';
import { type AdminRunList, type AdminRunReplay, coopRulesOf, parseConfig, PROBE_TEST, type Role, type RunStart } from '@galaxy/shared';
import { botInput, botPick, createSim, decodeLog, DEFAULT_CONTENT, encodeLog, fromBase64, replay, runSummary, SIM_VERSION, type SimOptions, stateHash, step, toBase64 } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAdminViaCli, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The panel's runs (GDD §16.2, §16.6; M6d-3), for admins: the list, a run's replay from what the server kept, and
// marking it. The local database is shared with every other test and the owner's own play: lists are read by player.

// A clock an hour behind, so a run can last a minute of it before it is finished (sessions expire by the database's now).
let clock = new Date(Date.now() - 3_600_000);
type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('rep');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id, username };
}

async function staff(role: Role) {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret, clock) });
  expect(res.statusCode).toBe(200);
  return { cookie: sessionCookie(res), username, id: (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id };
}
let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
});

const list = async (query: string) => (await get(ctx.app, `/galaxy/api/admin/runs?${query}`, { cookie: admin.cookie })).json() as AdminRunList;
const detail = async (id: string) => (await get(ctx.app, `/galaxy/api/admin/runs/${id}`, { cookie: admin.cookie })).json() as AdminRunReplay;
const mark = (id: string, suspicious: boolean, cookie = admin.cookie) => post(ctx.app, `/galaxy/api/admin/runs/${id}/mark`, { suspicious, reason: 'Revisada en el reproductor' }, { cookie });
const audits = (id: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'before', 'after']).where('target_id', '=', id).orderBy('id').execute();

/** A finished run straight in the table (two minutes long, so it counts for the profile). */
async function finishedRun(accountId: string, over: { suspicious?: boolean; outcome?: 'extracted' | 'died' | 'abandoned' | null; at?: Date } = {}) {
  const at = over.at ?? new Date();
  const done = over.outcome !== null;
  const row = await ctx.db
    .insertInto('galaxy.runs')
    .values({
      account_id: accountId,
      seed: '1',
      sector: 'outer-nebula',
      probe: 'lumen',
      relics: '[]',
      content_version: 0,
      sim_version: SIM_VERSION,
      start_key: randomUUID(),
      started_at: at,
      flags: [],
      suspicious: over.suspicious ?? false,
      ...(done ? { finished_at: at, outcome: over.outcome ?? 'died', ticks: 7200, depth: 1, kills: 5, boss_kills: 0, level: 2, seconds: 120, hash: '0123456789abcdef', payout: '{}' } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('quién entra', () => {
  test('un jugador o un moderador reciben 403; una página o un filtro malos dan 400', async () => {
    const p = await player();
    const mod = await staff('moderator');
    const run = await finishedRun(p.id);
    for (const cookie of [p.cookie, mod.cookie]) {
      expect((await get(ctx.app, '/galaxy/api/admin/runs', { cookie })).statusCode).toBe(403);
      expect((await get(ctx.app, `/galaxy/api/admin/runs/${run}`, { cookie })).statusCode).toBe(403);
      expect((await mark(run, true, cookie)).statusCode).toBe(403);
    }
    expect((await get(ctx.app, '/galaxy/api/admin/runs?page=0', { cookie: admin.cookie })).statusCode).toBe(400);
    expect((await get(ctx.app, '/galaxy/api/admin/runs?suspicious=quizas', { cookie: admin.cookie })).statusCode).toBe(400);
    expect((await get(ctx.app, '/galaxy/api/admin/runs/no-es-uuid', { cookie: admin.cookie })).statusCode).toBe(400);
    expect((await get(ctx.app, `/galaxy/api/admin/runs/${randomUUID()}`, { cookie: admin.cookie })).statusCode).toBe(404);
  });
});

describe('la lista', () => {
  test('va de la más nueva a la más vieja y filtra por jugador y por sospechosas', async () => {
    const p = await player();
    const old = await finishedRun(p.id, { at: new Date(Date.now() - 60_000) });
    const flagged = await finishedRun(p.id, { suspicious: true });
    const all = await list(`player=${p.username}`);
    expect(all.runs.map((r) => r.id)).toEqual([flagged, old]);
    expect(all.total).toBe(2);
    expect(all.runs[0]).toMatchObject({ player: p.username, sector: 'outer-nebula', probe: 'lumen', outcome: 'died', seconds: 120, suspicious: true });
    expect((await list(`player=${p.username}&suspicious=true`)).runs.map((r) => r.id)).toEqual([flagged]);
    expect((await list(`player=${p.username}&suspicious=false`)).runs.map((r) => r.id)).toEqual([old]);
    // Anyone else's runs are in the unfiltered list, newest first, 50 a page.
    const page = await list('page=1');
    expect(page.runs.length).toBeLessThanOrEqual(50);
    expect(page.runs.every((r, i) => i === 0 || r.startedAt <= page.runs[i - 1]!.startedAt)).toBe(true);
  });
});

describe('la repetición', () => {
  test('una partida jugada con el bot se repite con lo que da la API y llega al hash guardado', async () => {
    const p = await player();
    const res = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(res.statusCode).toBe(200);
    const start = res.json() as RunStart;
    const opts: SimOptions = { seed: start.seed, content: start.content, sector: start.sector, probes: [{ probe: start.probe, relics: start.relics, bonuses: start.bonuses, variant: start.variant }], anomaly: start.anomaly, record: true };
    const sim = createSim(opts);
    while (sim.tick < 1200 && (sim.status === 'running' || sim.status === 'choosing')) {
      if (sim.status === 'choosing') step(sim, sim.probes.map((q) => ({ mx: 0, my: 0, aim: -1, pick: q.offer ? botPick(q.offer) : -1 })));
      else step(sim, sim.probes.map((q) => botInput(sim, q.index)));
    }
    const s = runSummary(sim);
    clock = new Date(clock.getTime() + 60_000);
    const done = await post(
      ctx.app,
      `/galaxy/api/runs/${start.id}/finish`,
      { outcome: sim.status === 'dead' ? 'died' : 'abandoned', ticks: s.ticks, depth: s.depth, kills: s.kills, bossKills: s.bossKills, level: s.level, loot: s.loot, hash: s.hash, inputs: toBase64(encodeLog(sim.log!)) },
      { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } },
    );
    expect(done.statusCode).toBe(200);

    const r = await detail(start.id);
    expect(r.run).toMatchObject({ id: start.id, player: p.username, ticks: s.ticks, hash: s.hash, simVersion: SIM_VERSION, kills: s.kills, level: s.level });
    expect(r.start).toEqual({ seed: start.seed, sector: start.sector, probe: start.probe, relics: start.relics, bonuses: start.bonuses, variant: start.variant, anomaly: start.anomaly, content: start.content });
    const again = replay({ ...r.start, probes: [{ probe: r.start.probe, relics: r.start.relics, bonuses: r.start.bonuses, variant: r.start.variant }], anomaly: r.start.anomaly, record: false }, decodeLog(fromBase64(r.inputs!)), r.run.ticks!);
    expect(stateHash(again)).toBe(r.run.hash);
  });

  test('una partida que el servidor recortó guarda lo que envió y se repite hasta ahí', async () => {
    const p = await player();
    const res = await post(ctx.app, '/galaxy/api/runs', { sector: 'outer-nebula', probe: 'lumen', simVersion: SIM_VERSION }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    const start = res.json() as RunStart;
    const sim = createSim({ seed: start.seed, content: start.content, sector: start.sector, probes: [{ probe: start.probe, relics: start.relics, bonuses: start.bonuses, variant: start.variant }], record: true });
    while (sim.tick < 3000 && (sim.status === 'running' || sim.status === 'choosing')) {
      if (sim.status === 'choosing') step(sim, sim.probes.map((q) => ({ mx: 0, my: 0, aim: -1, pick: q.offer ? botPick(q.offer) : -1 })));
      else step(sim, sim.probes.map((q) => botInput(sim, q.index)));
    }
    const s = runSummary(sim);
    // Ten seconds of real time for fifty of play: the server clips the ticks it keeps (too_fast).
    clock = new Date(clock.getTime() + 10_000);
    const done = await post(
      ctx.app,
      `/galaxy/api/runs/${start.id}/finish`,
      { outcome: sim.status === 'dead' ? 'died' : 'abandoned', ticks: s.ticks, depth: s.depth, kills: s.kills, bossKills: s.bossKills, level: s.level, loot: s.loot, hash: s.hash, inputs: toBase64(encodeLog(sim.log!)) },
      { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } },
    );
    expect(done.statusCode).toBe(200);
    const r = await detail(start.id);
    expect(r.run.flags).toContain('too_fast');
    expect(r.run.ticks).toBeLessThan(s.ticks);
    expect(r.run.claimed).toEqual({ ticks: s.ticks, depth: s.depth, kills: s.kills, bossKills: s.bossKills, level: s.level });
    const again = replay({ ...r.start, probes: [{ probe: r.start.probe, relics: r.start.relics, bonuses: r.start.bonuses, variant: r.start.variant }], record: false }, decodeLog(fromBase64(r.inputs!)), r.run.claimed!.ticks);
    expect(stateHash(again)).toBe(r.run.hash);
  });

  test('si la versión de su contenido ya no está, se repite con el de por defecto y lo dice', async () => {
    const p = await player();
    const run = await finishedRun(p.id);
    const open = await finishedRun(p.id, { outcome: null });
    await ctx.db.updateTable('galaxy.runs').set({ content_version: 987_654 }).where('id', '=', open).execute();
    const r = await detail(open);
    expect(r.contentFallback).toBe(true);
    expect(r.start.content).toEqual(DEFAULT_CONTENT);
    expect((await detail(run)).contentFallback).toBe(false);
  });

  test('una partida sin terminar sale sin entradas', async () => {
    const p = await player();
    const run = await finishedRun(p.id, { outcome: null });
    const r = await detail(run);
    expect(r.run).toMatchObject({ outcome: null, finishedAt: null, ticks: null, hash: null });
    expect(r.inputs).toBeNull();
    expect(r.start.bonuses).toEqual([]);
    expect(r.start.variant).toBeNull();
  });
});

describe('las marcas', () => {
  test('marcar y desmarcar queda auditado, y repetirlo no escribe otra fila', async () => {
    const p = await player();
    const run = await finishedRun(p.id);
    const first = await mark(run, true);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ suspicious: true, flags: ['admin'] });
    expect((await mark(run, true)).json()).toEqual({ suspicious: true, flags: ['admin'] });
    expect((await mark(run, false)).json()).toEqual({ suspicious: false, flags: [] });
    expect((await mark(run, false)).statusCode).toBe(200);
    const rows = await audits(run);
    expect(rows.map((a) => a.action)).toEqual(['run.mark', 'run.unmark']);
    expect(rows[0]).toMatchObject({ before: { suspicious: false, flags: [] }, after: { suspicious: true, flags: ['admin'] } });
    expect((await detail(run)).run).toMatchObject({ suspicious: false, flags: [] });
  });

  test('una marca deja la partida fuera de lo que cuenta el perfil, y quitarla la devuelve', async () => {
    const p = await player();
    const run = await finishedRun(p.id);
    const runs = async () => ((await get(ctx.app, `/galaxy/api/profiles/${p.username}`, { cookie: p.cookie })).json() as { records: { runs: number } }).records.runs;
    expect(await runs()).toBe(1);
    await mark(run, true);
    expect(await runs()).toBe(0);
    await mark(run, false);
    expect(await runs()).toBe(1);
  });

  test('no se marca una partida propia, ni de un superadmin, ni una sin terminar', async () => {
    const own = await finishedRun(admin.id);
    expect((await mark(own, true)).json()).toMatchObject({ error: 'self_target' });
    const boss = await createAdminViaCli(ctx.db, 'superadmin');
    const bossId = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', boss.username).executeTakeFirstOrThrow()).id;
    const theirs = await mark(await finishedRun(bossId), true);
    expect(theirs.statusCode).toBe(403);
    expect(theirs.json()).toMatchObject({ error: 'staff_target' });
    const p = await player();
    const open = await mark(await finishedRun(p.id, { outcome: null }), true);
    expect(open.statusCode).toBe(409);
    expect(open.json()).toMatchObject({ error: 'run_open' });
  });
});

describe('una partida en grupo (fase 6c)', () => {
  test('se repite entera: sus entradas compartidas, sus jugadores y el sitio del que se mira', async () => {
    const [p, q] = [await player(), await player()];
    const players = [p, q].map((x) => ({ username: x.username, probe: 'lumen', relics: [], bonuses: [], variant: null }));
    const log = encodeLog({ probes: 2, events: [] });
    const coop = await ctx.db
      .insertInto('galaxy.coop_runs')
      .values({ room_code: 'ABC234', kind: 'private', leader_id: p.id, sector: 'outer-nebula', seed: '777', anomaly: null, rules: JSON.stringify(coopRulesOf(parseConfig('coop', {}))), players: JSON.stringify(players), content_version: 0, sim_version: SIM_VERSION })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.db.updateTable('galaxy.coop_runs').set({ state: 'ended', outcome: 'died', ticks: 300, depth: 1, boss_kills: 0, hash: 'fedcba9876543210', ended_at: new Date() }).where('id', '=', coop.id).execute();
    await ctx.db.insertInto('galaxy.coop_run_inputs').values({ coop_run_id: coop.id, inputs: Buffer.from(log), ticks: 300 }).execute();
    const row = await ctx.db
      .insertInto('galaxy.runs')
      .values({
        account_id: q.id,
        seed: '777',
        sector: 'outer-nebula',
        probe: 'lumen',
        relics: '[]',
        content_version: 0,
        sim_version: SIM_VERSION,
        start_key: randomUUID(),
        started_at: new Date(),
        flags: [],
        suspicious: false,
        coop_run_id: coop.id,
        slot: 1,
        party_size: 2,
        finished_at: new Date(),
        outcome: 'died',
        ticks: 300,
        depth: 1,
        kills: 0,
        boss_kills: 0,
        level: 1,
        seconds: 5,
        hash: 'fedcba9876543210',
        payout: '{}',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const d = await detail(row.id);
    expect(d.inputs).toBe(toBase64(log));
    expect(d.start.seed).toBe('777');
    expect(d.coop).toMatchObject({ slot: 1, ticks: 300, depth: 1, hash: 'fedcba9876543210' });
    expect(d.coop?.players.map((x) => x.username)).toEqual([p.username, q.username]);
    expect(d.coop?.rules).toEqual(coopRulesOf(parseConfig('coop', {})));
  });

  test('la lista dice cuántos eran en una partida en grupo y filtra en grupo o solo (fase 7)', async () => {
    const [p, q] = [await player(), await player()];
    const players = [p, q].map((x) => ({ username: x.username, probe: 'lumen', relics: [], bonuses: [], variant: null }));
    const coop = await ctx.db
      .insertInto('galaxy.coop_runs')
      .values({ room_code: 'GRP234', kind: 'private', leader_id: p.id, sector: 'outer-nebula', seed: '5', anomaly: null, rules: '{}', players: JSON.stringify(players), content_version: 0, sim_version: SIM_VERSION })
      .returning('id')
      .executeTakeFirstOrThrow();
    const grouped = await ctx.db
      .insertInto('galaxy.runs')
      .values({ account_id: q.id, seed: '5', sector: 'outer-nebula', probe: 'lumen', relics: '[]', content_version: 0, sim_version: SIM_VERSION, start_key: randomUUID(), started_at: new Date(), flags: [], suspicious: false, coop_run_id: coop.id, slot: 1, party_size: 2 })
      .returning('id')
      .executeTakeFirstOrThrow();
    const solo = await finishedRun(q.id);
    const all = await list(`player=${q.username}`);
    expect(all.runs.find((r) => r.id === grouped.id)?.party).toBe(2);
    expect(all.runs.find((r) => r.id === solo)?.party).toBeNull();
    expect((await list(`player=${q.username}&group=true`)).runs.map((r) => r.id)).toEqual([grouped.id]);
    expect((await list(`player=${q.username}&group=false`)).runs.map((r) => r.id)).toEqual([solo]);
  });
});
