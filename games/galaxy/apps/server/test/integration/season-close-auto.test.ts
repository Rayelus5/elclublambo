import { randomBytes } from 'node:crypto';
import { type LiveEvent, madridDayOf, madridMidnightOf, parseConfig, PROBE_TEST } from '@galaxy/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createConfigService } from '../../src/config/service';
import { seasonTick } from '../../src/season/jobs';
import { createSeasonStore, saveSeasonDraft, scheduleSeason, seasonAwareConfig } from '../../src/season/records';
import { post, sessionCookie, testApp, uniqueName } from '../helpers';

// Seasons close and start on their own (plan «temporadas como fichas», PR 2): the minute's pass archives the season
// that ended with its numbers, skips from its podium who cannot win prizes for their place, writes each ranked player
// where they finished, and tells everyone online, once, that the new one started. No other file makes season records.

const tag = randomBytes(3).toString('hex');
const ENDED = `tc-${tag}`;
const OPEN = `tn-${tag}`;
const today = madridDayOf(new Date().toISOString());
const dayOff = (n: number) => {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  return madridMidnightOf(new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10));
};
const actor = { id: null, label: 'test' };
const ctx = { labNodes: parseConfig('lab', {}).nodes, anomalies: ['contagion'] };
let app: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => {
  app = await testApp();
  await saveSeasonDraft(app.db, { id: ENDED, name: 'Prueba que acaba', startsAt: dayOff(-10), endsAt: dayOff(0), rules: { anomaly: 'contagion', tiers: [100, 200, 300, 400, 500] }, route: { closing: { ...parseConfig('seasonRoute', {}).closing, podiumSize: 1 } } }, ctx, actor, 'Prueba');
  await saveSeasonDraft(app.db, { id: OPEN, name: 'Prueba que empieza', startsAt: dayOff(0), endsAt: dayOff(20), rules: { anomaly: 'contagion' } }, ctx, actor, 'Prueba');
  await scheduleSeason(app.db, ENDED, ctx, actor, 'Prueba');
  await scheduleSeason(app.db, OPEN, ctx, actor, 'Prueba');
});
afterAll(async () => {
  await app.db.deleteFrom('galaxy.seasons').where('id', 'in', [ENDED, OPEN]).execute();
  await app.close();
});

async function player(points: number) {
  const username = uniqueName('scla');
  const res = await post(app.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const accountId = (res.json() as { id: string }).id;
  await post(app.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await app.db.insertInto('galaxy.season_adjustments').values({ account_id: accountId, season: ENDED, points }).execute();
  return { username, accountId };
}

test('la pasada de cada minuto cierra la que acabó (con su foto, su podio y los avisos) y anuncia una vez la nueva', async () => {
  // A huge score keeps these two first whatever other files left in the window.
  const admin = await player(1_000_000);
  const second = await player(900_000);
  await app.db.updateTable('galaxy.accounts').set({ prize_eligible: false }).where('id', '=', admin.accountId).execute();

  const store = createSeasonStore(app.db, { ttlMs: 0 });
  const now = () => new Date();
  const config = seasonAwareConfig(createConfigService(app.db, { ttlMs: 0 }), store, now);
  const sent: { ids: string[]; event: LiveEvent }[] = [];
  const live = { onlineIds: () => ['a1', 'a2'], sendMany: (ids: Iterable<string>, event: LiveEvent) => void sent.push({ ids: [...ids], event }) };

  expect(await seasonTick({ db: app.db, config, store, now, live })).toEqual({ announced: OPEN });
  expect(sent).toEqual([{ ids: ['a1', 'a2'], event: { type: 'notice', notice: { kind: 'season', event: 'started', id: OPEN, name: 'Prueba que empieza' } } }]);

  const archive = await app.db.selectFrom('galaxy.season_archive').select(['players', 'stats']).where('season', '=', ENDED).executeTakeFirstOrThrow();
  expect(archive.stats).toMatchObject({ players: archive.players });
  expect((archive.stats as { tiers: Record<string, number> }).tiers.stellar).toBeGreaterThanOrEqual(2);

  const results = await app.db.selectFrom('galaxy.season_results').select(['account_id', 'rank', 'podium']).where('season', '=', ENDED).where('account_id', 'in', [admin.accountId, second.accountId]).orderBy('rank').execute();
  // The admin keeps first place without the podium (size 1 here); the next one who can win takes it.
  expect(results).toEqual([
    { account_id: admin.accountId, rank: 1, podium: false },
    { account_id: second.accountId, rank: 2, podium: true },
  ]);

  const mail = await app.db
    .selectFrom('galaxy.mailbox_receipts as r')
    .innerJoin('galaxy.mailbox_messages as m', 'm.id', 'r.message_id')
    .select(['m.type', 'm.title', 'm.body'])
    .where('r.account_id', '=', second.accountId)
    .where('m.type', '=', 'season')
    .executeTakeFirstOrThrow();
  expect(mail).toMatchObject({ type: 'season', title: 'Prueba que acaba ha terminado' });
  expect(mail.body).toContain('Quedaste 2.º en el tramo Estelar');
  expect((await app.db.selectFrom('galaxy.seasons').select('state').where('id', '=', ENDED).executeTakeFirstOrThrow()).state).toBe('closed');

  // Again: nothing more to close, nothing more to announce, no second message.
  expect(await seasonTick({ db: app.db, config, store, now, live })).toEqual({ announced: null });
  expect(sent).toHaveLength(1);
  const count = await app.db
    .selectFrom('galaxy.mailbox_receipts as r')
    .innerJoin('galaxy.mailbox_messages as m', 'm.id', 'r.message_id')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('r.account_id', '=', second.accountId)
    .where('m.type', '=', 'season')
    .executeTakeFirstOrThrow();
  expect(Number(count.n)).toBe(1);
});
