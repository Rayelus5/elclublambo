import { randomBytes } from 'node:crypto';
import { type AdminSeason, type AdminSeasonList, PROBE_TEST, type SeasonView } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createAdminViaCli, get, post, randomIp, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The panel's «Temporadas» (plan «temporadas como fichas», 2026-11-21): a draft saved with a reason, checked before it
// is scheduled, scheduled and unscheduled with the password, removed while a draft; an admin previews it as players
// will see it. Far ahead, under ids of its own, and removed at the end so no other file meets them.

const tag = randomBytes(3).toString('hex');
const ID = `tadm-${tag}`;
const record = { id: ID, name: 'Temporada de panel', startsAt: '2095-01-31T23:00:00.000Z', endsAt: '2095-02-28T23:00:00.000Z', rules: { anomaly: 'contagion' }, route: { currency: { name: 'Chispas', perPoint: 1, dustRate: 1 } } };
let ctx: Awaited<ReturnType<typeof testApp>>;
let admin: { cookie: string; password: string };

beforeAll(async () => {
  ctx = await testApp({ seasons: true });
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, 'admin');
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  admin = { cookie: sessionCookie(res), password };
});
afterAll(async () => {
  await ctx.db.deleteFrom('galaxy.seasons').where('id', '=', ID).execute();
  await ctx.close();
});

const A = (p = '') => `/galaxy/api/admin/seasons${p}`;

test('un borrador se guarda, se comprueba, se programa con la contraseña y se puede ver de antemano', async () => {
  const bad = (await post(ctx.app, A('/validate'), { record: { ...record, startsAt: '2095-02-01T10:00:00.000Z' } }, { cookie: admin.cookie })).json() as { ok: boolean; issues: { message: string }[] };
  expect(bad.ok).toBe(false);
  expect(bad.issues.map((i) => i.message)).toContain('season_midnight');

  const saved = await post(ctx.app, A(), { record, reason: 'Preparando' }, { cookie: admin.cookie });
  expect(saved.statusCode, saved.body).toBe(201);
  expect(saved.json()).toMatchObject({ id: ID, state: 'draft', open: false });

  expect((await post(ctx.app, A(`/${ID}/schedule`), { reason: 'A su hora', password: 'no-es-esta' }, { cookie: admin.cookie })).statusCode).toBeGreaterThanOrEqual(400);
  const scheduled = await post(ctx.app, A(`/${ID}/schedule`), { reason: 'A su hora', password: admin.password }, { cookie: admin.cookie });
  expect(scheduled.statusCode, scheduled.body).toBe(200);
  expect((scheduled.json() as AdminSeason).state).toBe('scheduled');

  const list = (await get(ctx.app, A(), { cookie: admin.cookie })).json() as AdminSeasonList;
  expect(list.seasons.find((s) => s.id === ID)).toMatchObject({ state: 'scheduled', name: 'Temporada de panel' });

  const preview = (await get(ctx.app, `/galaxy/api/season?preview=${ID}`, { cookie: admin.cookie })).json() as SeasonView;
  expect(preview.season).toMatchObject({ id: ID, name: 'Temporada de panel' });
  expect(preview.currency.name).toBe('Chispas');
  expect(preview.score).toBe(0);

  const unscheduled = await post(ctx.app, A(`/${ID}/unschedule`), { reason: 'Aún no', password: admin.password }, { cookie: admin.cookie });
  expect((unscheduled.json() as AdminSeason).state).toBe('draft');
  expect((await post(ctx.app, A(`/${ID}/delete`), { reason: 'Ya no' }, { cookie: admin.cookie })).statusCode).toBe(204);
  expect((await get(ctx.app, A(), { cookie: admin.cookie })).json().seasons.some((s: AdminSeason) => s.id === ID)).toBe(false);
});

test('un jugador no ve el panel ni la vista previa', async () => {
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username: uniqueName('sadm'), password: 'una-clave-larga' }, { ip: randomIp() });
  const cookie = sessionCookie(res);
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  expect((await get(ctx.app, A(), { cookie })).statusCode).toBe(403);
  expect((await get(ctx.app, `/galaxy/api/season?preview=${ID}`, { cookie })).statusCode).toBe(403);
});
