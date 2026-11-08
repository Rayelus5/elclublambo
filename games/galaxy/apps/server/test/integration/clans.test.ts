import { randomInt, randomUUID } from 'node:crypto';
import { type ClanList, type ClanView, type Leaderboard, type MyClan, PROBE_TEST, type Profile } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { invalidateLeaderboard } from '../../src/social/leaderboard';
import { fixedConfig, get, post, sessionCookie, testApp, uniqueName } from '../helpers';

// Clans on the server (GDD §14.3, §14.1; M5b-1): creating one costs coins and needs a level; open clans take anyone
// until they are full, closed ones take requests that the leader or an officer accepts; roles decide who can do what;
// the clan always has a leader while it has members; the leaderboard's Clanes tab adds up the members' season points.
// The app runs in its own season on a random minute long past (as in social.test.ts), so the clan scores only see
// this file's runs.

type Ctx = Awaited<ReturnType<typeof testApp>>;
const startsAt = new Date(Date.UTC(1990, 0, 1) + randomInt(30 * 365 * 24 * 60) * 60_000);
const season = { id: `clan-${randomInt(1_000_000)}`, name: 'Temporada de clanes', startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3 * 86_400_000).toISOString() };
const clock = new Date(startsAt.getTime() + 40 * 3_600_000);
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ now: () => clock, config: fixedConfig({ season, clans: { maxMembers: 5 } }) });
});
afterAll(() => ctx.close());

/** A new account with the probe test done, at `level` (its experience set straight in its row) and with coins. */
async function player(level = 5, coins = 5000) {
  const username = uniqueName('cln');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  const xp = [0, 0, 100, 300, 600, 1000, 1500][level] ?? 1000;
  if (xp > 0) await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp }).execute();
  if (coins > 0) await credit(ctx.db, id, 'coins', coins, 'test');
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

let tagSeq = randomInt(100, 900);
const freshTag = () => `${String.fromCharCode(65 + randomInt(26))}${tagSeq++}`.slice(0, 4);
const create = (p: P, over: Record<string, unknown> = {}) =>
  post(ctx.app, '/galaxy/api/clans', { name: `Clan ${randomInt(1_000_000)}`, tag: freshTag(), description: 'Exploradores', emblem: 'comet', color: 'uv', open: true, ...over }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
const act = (p: P, path: string, body?: object) => post(ctx.app, `/galaxy/api/clans/${path}`, body, { cookie: p.cookie });
const view = async (p: P, tag: string) => (await get(ctx.app, `/galaxy/api/clans/${tag}`, { cookie: p.cookie })).json() as ClanView;
const mine = async (p: P) => (await get(ctx.app, '/galaxy/api/clans/mine', { cookie: p.cookie })).json() as MyClan;

async function clanOf(leader: P, over: Record<string, unknown> = {}): Promise<ClanView> {
  const res = await create(leader, over);
  expect(res.statusCode).toBe(200);
  return res.json() as ClanView;
}

describe('crear', () => {
  test('cobra su coste, deja al creador de líder y la vista pública trae solo lo público', async () => {
    const a = await player();
    const before = (await getWallet(ctx.db, a.id)).coins;
    const c = await clanOf(a, { tag: 'gx' + randomInt(10, 99), name: `Los Ñandúes ${randomInt(1000)}` });
    expect(c.tag).toMatch(/^GX\d\d$/);
    expect((await getWallet(ctx.db, a.id)).coins).toBe(before - 2000);
    expect(c.members).toEqual([{ username: a.username, role: 'leader', level: 5, points: 0, joinedAt: expect.any(String) }]);
    expect(c.me).toEqual({ role: 'leader' });
    expect(c.requests).toEqual([]);
    expect(Object.keys(c).sort()).toEqual(['color', 'createdAt', 'description', 'emblem', 'maxMembers', 'me', 'members', 'name', 'open', 'rank', 'requests', 'score', 'tag']);
    expect(await mine(a)).toMatchObject({ tag: c.tag });
    // Someone else sees no requests and no role.
    const b = await player();
    const other = await view(b, c.tag.toLowerCase());
    expect(other.requests).toBeUndefined();
    expect(other.me).toBeNull();
    expect(Object.keys(other.members[0]!).sort()).toEqual(['joinedAt', 'level', 'points', 'role', 'username']);
  });

  test('nombre o etiqueta ocupados, nivel bajo o sin monedas: nada creado ni cobrado', async () => {
    const a = await player();
    const c = await clanOf(a);
    const b = await player();
    const wallet = (await getWallet(ctx.db, b.id)).coins;
    const dupName = await create(b, { name: c.name.toUpperCase() });
    expect(dupName.statusCode).toBe(409);
    expect(dupName.json()).toEqual({ error: 'clan_name_taken' });
    const dupTag = await create(b, { tag: c.tag.toLowerCase() });
    expect(dupTag.json()).toEqual({ error: 'clan_tag_taken' });
    expect((await getWallet(ctx.db, b.id)).coins).toBe(wallet);
    const low = await player(4);
    const lowRes = await create(low);
    expect(lowRes.statusCode).toBe(403);
    expect(lowRes.json()).toEqual({ error: 'level_too_low' });
    const poor = await player(5, 100);
    expect((await create(poor)).statusCode).toBe(402);
    expect(await mine(poor)).toBeNull();
  });

  test('desde un clan no se crea otro, ni se entra en otro', async () => {
    const a = await player();
    await clanOf(a);
    const again = await create(a);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_in_clan' });
    const b = await player();
    const other = await clanOf(b);
    expect((await act(a, `${other.tag}/join`)).json()).toEqual({ error: 'already_in_clan' });
  });
});

describe('entrar', () => {
  test('un clan abierto acepta a cualquiera hasta llenarse; dos a la vez por el último hueco: entra uno', async () => {
    const lead = await player();
    const c = await clanOf(lead);
    for (let i = 0; i < 3; i++) expect((await act(await player(1), `${c.tag}/join`)).statusCode).toBe(200);
    const [x, y] = [await player(1), await player(1)];
    const both = await Promise.all([act(x, `${c.tag}/join`), act(y, `${c.tag}/join`)]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'clan_full' });
    expect((await view(lead, c.tag)).members).toHaveLength(5);
  });

  test('un clan cerrado toma solicitudes: el oficial acepta, el miembro no, y al entrar se cancelan las demás', async () => {
    const lead = await player();
    const c = await clanOf(lead, { open: false });
    const other = await clanOf(await player());
    const asker = await player(1);
    expect((await act(asker, `${c.tag}/join`)).json()).toEqual({ error: 'clan_closed' });
    expect((await act(asker, `${c.tag}/request`)).statusCode).toBe(200);
    expect((await view(asker, c.tag)).me).toEqual({ requested: true });
    expect((await view(lead, c.tag)).requests).toEqual([asker.username]);

    // A member cannot accept; an officer can.
    const officer = await player(1);
    await act(officer, `${c.tag}/request`);
    await act(lead, `${c.tag}/requests/${officer.username}/accept`);
    const member = await player(1);
    await act(member, `${c.tag}/request`);
    await act(lead, `${c.tag}/requests/${member.username}/accept`);
    expect((await act(lead, `${c.tag}/members/${officer.username}/promote`)).statusCode).toBe(200);
    expect((await act(member, `${c.tag}/requests/${asker.username}/accept`)).json()).toEqual({ error: 'clan_forbidden' });

    // Joining another clan (open) drops the pending request.
    await act(asker, `${other.tag}/join`);
    expect((await view(lead, c.tag)).requests).toEqual([]);
    expect((await act(officer, `${c.tag}/requests/${asker.username}/accept`)).json()).toEqual({ error: 'request_not_found' });

    const late = await player(1);
    await act(late, `${c.tag}/request`);
    expect((await act(officer, `${c.tag}/requests/${late.username}/accept`)).statusCode).toBe(200);
    expect((await mine(late))!.me).toEqual({ role: 'member' });
    const no = await player(1);
    await act(no, `${c.tag}/request`);
    expect((await act(officer, `${c.tag}/requests/${no.username}/reject`)).statusCode).toBe(200);
    expect(await mine(no)).toBeNull();
    // Cancelling one's own request.
    const undecided = await player(1);
    await act(undecided, `${c.tag}/request`);
    expect((await post(ctx.app, `/galaxy/api/clans/${c.tag}/request/cancel`, undefined, { cookie: undecided.cookie })).statusCode).toBe(200);
    expect((await view(undecided, c.tag)).me).toBeNull();
  });
});

describe('roles y salidas', () => {
  test('quién puede con quién: el oficial no expulsa oficiales, nadie actúa sobre otro clan, el líder no se expulsa', async () => {
    const lead = await player();
    const c = await clanOf(lead);
    const [o1, o2, m] = [await player(1), await player(1), await player(1)];
    for (const p of [o1, o2, m]) await act(p, `${c.tag}/join`);
    await act(lead, `${c.tag}/members/${o1.username}/promote`);
    await act(lead, `${c.tag}/members/${o2.username}/promote`);
    expect((await act(o1, `${c.tag}/members/${o2.username}/kick`)).json()).toEqual({ error: 'clan_forbidden' });
    expect((await act(o1, `${c.tag}/members/${lead.username}/kick`)).json()).toEqual({ error: 'clan_forbidden' });
    expect((await act(m, `${c.tag}/members/${o1.username}/demote`)).json()).toEqual({ error: 'clan_forbidden' });
    expect((await act(lead, `${c.tag}/members/${lead.username}/kick`)).json()).toEqual({ error: 'clan_forbidden' });
    expect((await post(ctx.app, `/galaxy/api/clans/${c.tag}`, undefined, { cookie: o1.cookie })).statusCode).toBe(404);
    const stranger = await clanOf(await player());
    expect((await act(lead, `${stranger.tag}/members/${stranger.members[0]!.username}/kick`)).json()).toEqual({ error: 'clan_forbidden' });
    expect((await act(o1, `${c.tag}/members/${m.username}/kick`)).statusCode).toBe(200);
    expect(await mine(m)).toBeNull();
    // Editing is the leader's.
    expect((await ctx.app.inject({ method: 'PATCH', url: `/galaxy/api/clans/${c.tag}`, payload: { open: false }, headers: { cookie: `gs_sid=${o1.cookie}`, origin: 'http://localhost:5173' } })).statusCode).toBe(403);
    const edited = await ctx.app.inject({ method: 'PATCH', url: `/galaxy/api/clans/${c.tag}`, payload: { open: false, description: 'Cerrado' }, headers: { cookie: `gs_sid=${lead.cookie}`, origin: 'http://localhost:5173' } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ open: false, description: 'Cerrado' });
  });

  test('el líder transfiere, y al irse manda el oficial más antiguo; sin nadie, el clan se disuelve', async () => {
    const lead = await player();
    const c = await clanOf(lead);
    const [m1, o1] = [await player(1), await player(1)];
    await act(m1, `${c.tag}/join`);
    await act(o1, `${c.tag}/join`);
    await act(lead, `${c.tag}/members/${o1.username}/promote`);
    expect((await act(lead, `${c.tag}/leave`)).statusCode).toBe(200);
    const after = await view(o1, c.tag);
    expect(after.members.find((x) => x.username === o1.username)!.role).toBe('leader');
    expect(after.members.map((x) => x.username)).not.toContain(lead.username);

    expect((await act(o1, `${c.tag}/members/${m1.username}/transfer`)).statusCode).toBe(200);
    const now = await view(m1, c.tag);
    expect(now.me).toEqual({ role: 'leader' });
    expect(now.members.find((x) => x.username === o1.username)!.role).toBe('officer');

    await act(o1, `${c.tag}/leave`);
    expect((await act(m1, `${c.tag}/leave`)).statusCode).toBe(200);
    expect((await get(ctx.app, `/galaxy/api/clans/${c.tag}`, { cookie: m1.cookie })).statusCode).toBe(404);
    // Its name and tag are free again.
    expect((await create(await player(), { name: c.name, tag: c.tag })).statusCode).toBe(200);
  });
});

describe('buscar, la pestaña de clanes y el perfil', () => {
  test('la búsqueda encuentra por nombre o etiqueta', async () => {
    const a = await player();
    const c = await clanOf(a, { name: `Halcones Rojos ${randomInt(1000)}` });
    const byName = (await get(ctx.app, `/galaxy/api/clans?q=${encodeURIComponent('halcones rojos')}`, { cookie: a.cookie })).json() as ClanList;
    expect(byName.clans.map((x) => x.tag)).toContain(c.tag);
    // The rules a screen needs to offer «Crear clan» come with the list.
    expect(byName.rules).toEqual({ maxMembers: 5, createCost: { coins: 2000 }, minLevel: 5 });
    const byTag = (await get(ctx.app, `/galaxy/api/clans?q=${c.tag.toLowerCase()}`, { cookie: a.cookie })).json() as ClanList;
    expect(byTag.clans[0]).toEqual({ tag: c.tag, name: c.name, emblem: 'comet', color: 'uv', open: true, members: 1, maxMembers: 5, score: 0 });
    expect((await get(ctx.app, '/galaxy/api/clans?q=%25', { cookie: a.cookie })).statusCode).toBe(200);
  });

  test('la pestaña Clanes suma los puntos de temporada de sus miembros, y el perfil dice su clan', async () => {
    const a = await player();
    const b = await player(1);
    const c = await clanOf(a, { color: 'terminal', emblem: 'crown' });
    await act(b, `${c.tag}/join`);
    for (const [who, depth] of [[a, 3], [b, 2]] as const) {
      await ctx.db
        .insertInto('galaxy.runs')
        .values({ account_id: who.id, seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: '[]', content_version: 0, sim_version: SIM_VERSION, start_key: randomUUID(), started_at: clock, finished_at: clock, outcome: 'died', ticks: 36_000, depth, kills: 10, boss_kills: 0, level: 3, seconds: 600, hash: '0123456789abcdef', payout: '{}', runs_version: 0, flags: [], suspicious: false })
        .execute();
    }
    invalidateLeaderboard();
    const board = (await get(ctx.app, '/galaxy/api/leaderboard?tab=clans', { cookie: b.cookie })).json() as Leaderboard;
    expect(board.tab).toBe('clans');
    expect(board.rows).toEqual([]);
    expect(board.clans![0]).toEqual({ rank: 1, tag: c.tag, name: c.name, emblem: 'crown', color: 'terminal', members: 2, value: 50 });
    expect(board.myClan).toMatchObject({ tag: c.tag, value: 50 });
    expect((await view(a, c.tag))).toMatchObject({ score: 50, rank: 1 });
    expect((await view(a, c.tag)).members.find((x) => x.username === a.username)!.points).toBe(30);
    const p = (await get(ctx.app, `/galaxy/api/profiles/${b.username}`, { cookie: a.cookie })).json() as Profile;
    expect(p.clan).toEqual({ tag: c.tag, name: c.name, emblem: 'crown', color: 'terminal' });
  });

  test('sin sesión no hay clanes, y una etiqueta que no existe da 404', async () => {
    expect((await get(ctx.app, '/galaxy/api/clans')).statusCode).toBe(401);
    const a = await player(1);
    const res = await get(ctx.app, '/galaxy/api/clans/ZZZZ', { cookie: a.cookie });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'clan_not_found' });
  });
});
