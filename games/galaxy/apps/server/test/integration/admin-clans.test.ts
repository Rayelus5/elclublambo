import { randomInt, randomUUID } from 'node:crypto';
import { type AdminClan, type AdminClanRow, type MyClan, PROBE_TEST, type Role } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit } from '../../src/economy/wallet';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Clan moderation on the server (GDD §16.1, §16.4; M6c-1): admins only (moderators moderate chats, not clans). An admin
// finds a clan by tag or name, sees its roster, renames it (name, tag, description), kicks a member (the lead passes to
// the successor; the last one out dissolves it), hands the lead to a member, and dissolves it with their password.
// Every change is audited against the clan.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('acl');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: 1000 }).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

async function staff(role: Role) {
  const { username, password, totpSecret } = await createAdminViaCli(ctx.db, role);
  const login = await post(ctx.app, '/galaxy/api/auth/login', { username, password });
  const res = await post(ctx.app, '/galaxy/api/auth/totp', { challenge: login.json().challenge, code: totpNow(totpSecret) });
  expect(res.statusCode).toBe(200);
  return { cookie: sessionCookie(res), username, password };
}
let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
});

const freeTag = () => randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
const freeName = (word: string) => `${word} ${randomUUID().slice(0, 8).replace(/[^a-z]/g, 'x')}`;

/** A clan led by `leader`, with `officers` promoted and `members` plain members, in that order of joining. */
async function clan(leader: P, opts: { officers?: P[]; members?: P[]; name?: string } = {}) {
  await credit(ctx.db, leader.id, 'coins', 2000, 'test');
  // A random tag can meet one another test made: try another (CI on develop, 2026-11-08).
  let tag = freeTag();
  let name = opts.name ?? freeName('Clan');
  let res = await post(ctx.app, '/galaxy/api/clans', { name, tag, emblem: 'eye', color: 'ice' }, { cookie: leader.cookie, headers: { 'idempotency-key': randomUUID() } });
  for (let i = 0; i < 3 && res.statusCode === 409 && ['clan_tag_taken', 'clan_name_taken'].includes((res.json() as { error: string }).error); i++) {
    tag = freeTag();
    name = opts.name ?? freeName('Clan');
    res = await post(ctx.app, '/galaxy/api/clans', { name, tag, emblem: 'eye', color: 'ice' }, { cookie: leader.cookie, headers: { 'idempotency-key': randomUUID() } });
  }
  expect(res.statusCode).toBe(200);
  for (const m of [...(opts.officers ?? []), ...(opts.members ?? [])]) expect((await post(ctx.app, `/galaxy/api/clans/${tag}/join`, undefined, { cookie: m.cookie })).statusCode).toBe(200);
  for (const o of opts.officers ?? []) expect((await post(ctx.app, `/galaxy/api/clans/${tag}/members/${o.username}/promote`, undefined, { cookie: leader.cookie })).statusCode).toBe(200);
  const row = await ctx.db.selectFrom('galaxy.clans').select('id').where('tag', '=', tag).executeTakeFirstOrThrow();
  return { tag, name, id: row.id };
}

const A = (path: string) => `/galaxy/api/admin/clans${path}`;
const act = (path: string, body: object, cookie = admin.cookie) => post(ctx.app, A(path), body, { cookie });
const detail = async (tag: string) => (await get(ctx.app, A(`/${tag}`), { cookie: admin.cookie })).json() as AdminClan;
const mine = async (p: P) => (await get(ctx.app, '/galaxy/api/clans/mine', { cookie: p.cookie })).json() as MyClan;
const audits = (clanId: string) =>
  ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'actor_label', 'before', 'after', 'reason']).where('target_type', '=', 'clan').where('target_id', '=', clanId).orderBy('id').execute();

describe('quién entra', () => {
  test('un jugador o un moderador no ven ni tocan clanes', async () => {
    const leader = await player();
    const c = await clan(leader);
    const mod = await staff('moderator');
    for (const cookie of [leader.cookie, mod.cookie]) {
      expect((await get(ctx.app, A(`?q=${c.tag}`), { cookie })).statusCode).toBe(403);
      expect((await act(`/${c.tag}/edit`, { name: freeName('Robado'), reason: 'Prueba' }, cookie)).statusCode).toBe(403);
    }
    expect((await get(ctx.app, A(''))).statusCode).toBe(401);
  });
});

describe('buscar y ver', () => {
  test('por etiqueta o por un trozo del nombre sin acentos, con miembros y líder; vacío da los más nuevos', async () => {
    const [leader, member] = await Promise.all([player(), player()]);
    const c = await clan(leader, { members: [member], name: freeName('Órbita') });
    const byTag = (await get(ctx.app, A(`?q=${c.tag.toLowerCase()}`), { cookie: admin.cookie })).json() as AdminClanRow[];
    expect(byTag.find((r) => r.tag === c.tag)).toMatchObject({ name: c.name, members: 2, leader: leader.username });
    const byName = (await get(ctx.app, A(`?q=${encodeURIComponent(`orbita ${c.name.split(' ')[1]!.slice(0, 4)}`)}`), { cookie: admin.cookie })).json() as AdminClanRow[];
    expect(byName.map((r) => r.tag)).toContain(c.tag);
    const newest = (await get(ctx.app, A(''), { cookie: admin.cookie })).json() as AdminClanRow[];
    expect(newest.length).toBeLessThanOrEqual(20);
    expect((await detail(c.tag)).roster.map((m) => [m.username, m.role])).toEqual([
      [leader.username, 'leader'],
      [member.username, 'member'],
    ]);
    expect((await get(ctx.app, A('/ZZZZ'), { cookie: admin.cookie })).json()).toEqual({ error: 'clan_not_found' });
  });
});

describe('cambios', () => {
  test('renombrar nombre, etiqueta y descripción, con lo que cambia en la auditoría; lo ocupado da 409', async () => {
    const [leader, other] = await Promise.all([player(), player()]);
    const c = await clan(leader);
    const taken = await clan(other);
    const name = freeName('Limpio');
    const tag = freeTag();
    const res = await act(`/${c.tag}/edit`, { name, tag, description: '', reason: 'Nombre ofensivo' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tag, name, description: '' });
    expect((await get(ctx.app, A(`/${c.tag}`), { cookie: admin.cookie })).json()).toEqual({ error: 'clan_not_found' });
    expect((await act(`/${tag}/edit`, { name: taken.name.toUpperCase(), reason: 'Choque' })).json()).toEqual({ error: 'clan_name_taken' });
    expect((await act(`/${tag}/edit`, { tag: taken.tag, reason: 'Choque' })).json()).toEqual({ error: 'clan_tag_taken' });
    expect(await audits(c.id)).toEqual([
      { action: 'clan.edit', actor_label: admin.username, before: { name: c.name, tag: c.tag, description: '' }, after: { name, tag, description: '' }, reason: 'Nombre ofensivo' },
    ]);
  });

  test('expulsar al líder pasa el mando al oficial más antiguo y lo deja fuera un tiempo', async () => {
    const [leader, officer, member] = await Promise.all([player(), player(), player()]);
    const c = await clan(leader, { officers: [officer], members: [member] });
    expect((await act(`/${c.tag}/kick`, { username: leader.username, reason: 'Trampas' })).statusCode).toBe(200);
    expect((await detail(c.tag)).roster.map((m) => [m.username, m.role])).toEqual([
      [officer.username, 'leader'],
      [member.username, 'member'],
    ]);
    expect(await mine(leader)).toBeNull();
    expect((await post(ctx.app, `/galaxy/api/clans/${c.tag}/join`, undefined, { cookie: leader.cookie })).json()).toMatchObject({ error: 'clan_kicked' });
    expect((await act(`/${c.tag}/kick`, { username: leader.username, reason: 'Otra vez' })).json()).toEqual({ error: 'not_in_clan' });
    expect(await audits(c.id)).toMatchObject([{ action: 'clan.kick', before: { username: leader.username, role: 'leader' }, after: { dissolved: false }, reason: 'Trampas' }]);
  });

  test('expulsar al último miembro disuelve el clan', async () => {
    const leader = await player();
    const c = await clan(leader);
    expect((await act(`/${c.tag}/kick`, { username: leader.username, reason: 'Clan de spam' })).json()).toMatchObject({ dissolved: true });
    expect((await get(ctx.app, A(`/${c.tag}`), { cookie: admin.cookie })).json()).toEqual({ error: 'clan_not_found' });
    expect(await audits(c.id)).toMatchObject([{ action: 'clan.kick', after: { dissolved: true } }]);
  });

  test('traspasar el liderazgo a un miembro; el líder anterior queda de oficial', async () => {
    const [leader, member, outsider] = await Promise.all([player(), player(), player()]);
    const c = await clan(leader, { members: [member] });
    expect((await act(`/${c.tag}/leader`, { username: outsider.username, reason: 'Líder inactivo' })).json()).toEqual({ error: 'not_in_clan' });
    expect((await act(`/${c.tag}/leader`, { username: member.username, reason: 'Líder inactivo' })).statusCode).toBe(200);
    expect((await detail(c.tag)).roster.map((m) => [m.username, m.role])).toEqual([
      [leader.username, 'officer'],
      [member.username, 'leader'],
    ]);
    expect(await audits(c.id)).toEqual([{ action: 'clan.leader', actor_label: admin.username, before: { leader: leader.username }, after: { leader: member.username }, reason: 'Líder inactivo' }]);
  });

  test('disolver pide la contraseña del admin; con ella el clan desaparece para todos', async () => {
    const [leader, member] = await Promise.all([player(), player()]);
    const c = await clan(leader, { members: [member] });
    expect((await act(`/${c.tag}/dissolve`, { reason: 'Clan de trampas', password: 'no-es-esta' })).json()).toEqual({ error: 'password_wrong' });
    expect((await detail(c.tag)).members).toBe(2);
    expect((await act(`/${c.tag}/dissolve`, { reason: 'Clan de trampas', password: admin.password })).json()).toEqual({ dissolved: true });
    expect((await get(ctx.app, A(`/${c.tag}`), { cookie: admin.cookie })).json()).toEqual({ error: 'clan_not_found' });
    expect(await mine(member)).toBeNull();
    expect(await audits(c.id)).toEqual([
      { action: 'clan.dissolve', actor_label: admin.username, before: { tag: c.tag, name: c.name, members: [leader.username, member.username] }, after: null, reason: 'Clan de trampas' },
    ]);
  });
});
