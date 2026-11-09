import { type PlayerReportPage, PROBE_TEST, type RoomView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import type { CoopService } from '../../src/coop/service';
import { createAdminViaCli, get, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Reports of a player (multiplayer plan, phase 7): a teammate of a group run reports another (once per run), nobody
// else may, and a moderator reviews the queue (audited).
let ctx: Awaited<ReturnType<typeof testApp>>;
let coop: CoopService;
beforeAll(async () => {
  ctx = await testApp();
  coop = (ctx.app as unknown as { galaxyCoop: CoopService }).galaxyCoop;
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('rep');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  await put(ctx.app, '/galaxy/api/tutorial', { action: 'skip' }, { cookie });
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, username };
}
type P = Awaited<ReturnType<typeof player>>;
const act = (p: P, path: string, body?: unknown) => post(ctx.app, `/galaxy/api/rooms${path}`, body, { cookie: p.cookie });

/** A group run of two that ended (both left). */
async function playedTogether(): Promise<{ a: P; b: P; runId: string }> {
  const [a, b] = [await player(), await player()];
  const room = (await act(a, '', { kind: 'private', sector: 'outer-nebula' })).json() as RoomView;
  await act(b, '/join', { code: room.code });
  await act(b, '/ready', { ready: true });
  const started = (await act(a, '/start')).json() as RoomView;
  const runId = started.run!.id;
  await coop.abandon(runId);
  return { a, b, runId };
}

const report = (p: P, runId: string, body: unknown) => post(ctx.app, `/galaxy/api/coop/runs/${runId}/report`, body, { cookie: p.cookie });

test('un compañero denuncia a otro una vez por partida; nadie más puede, ni a sí mismo; el moderador la revisa', async () => {
  const { a, b, runId } = await playedTogether();
  const outsider = await player();
  expect((await report(a, runId, { username: b.username, reason: 'idle', note: 'No se movió en toda la partida' })).statusCode).toBe(200);
  // Again: nothing new.
  expect((await report(a, runId, { username: b.username, reason: 'abuse' })).statusCode).toBe(200);
  expect((await report(outsider, runId, { username: b.username, reason: 'idle' })).statusCode).toBe(403);
  expect((await report(a, runId, { username: outsider.username, reason: 'idle' })).statusCode).toBe(403);
  expect((await report(a, runId, { username: a.username, reason: 'idle' })).statusCode).toBe(400);
  expect((await report(a, runId, { username: b.username, reason: 'lag' })).statusCode).toBe(400);

  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'moderator');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const staff = sessionCookie(await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) }));
  expect((await get(ctx.app, '/galaxy/api/admin/moderation/player-reports', { cookie: a.cookie })).statusCode).toBe(403);
  const page = (await get(ctx.app, '/galaxy/api/admin/moderation/player-reports', { cookie: staff })).json() as PlayerReportPage;
  const mine = page.reports.filter((r) => r.coopRunId === runId);
  expect(mine).toHaveLength(1);
  expect(mine[0]).toMatchObject({ reporter: a.username, reported: b.username, reason: 'idle', note: 'No se movió en toda la partida' });
  expect(mine[0]!.reportedRunId).toMatch(/^[0-9a-f-]{36}$/);
  const done = await post(ctx.app, `/galaxy/api/admin/moderation/player-reports/${mine[0]!.id}`, { outcome: 'dismissed', reason: 'Estaba ayudando desde lejos' }, { cookie: staff });
  expect(done.statusCode, done.body).toBe(200);
  const after = (await get(ctx.app, '/galaxy/api/admin/moderation/player-reports', { cookie: staff })).json() as PlayerReportPage;
  expect(after.reports.some((r) => r.id === mine[0]!.id)).toBe(false);
  const audit = await ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'reason']).where('target_id', '=', mine[0]!.id).execute();
  expect(audit).toEqual([{ action: 'player_report.review', reason: 'Estaba ayudando desde lejos' }]);
  // Reviewed once: a second review is refused.
  expect((await post(ctx.app, `/galaxy/api/admin/moderation/player-reports/${mine[0]!.id}`, { outcome: 'actioned', reason: 'Otra vez' }, { cookie: staff })).statusCode).toBe(409);
});
