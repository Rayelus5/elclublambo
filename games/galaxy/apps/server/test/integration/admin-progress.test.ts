import { randomBytes, randomUUID } from 'node:crypto';
import { type AdminProgress, type HangarView, type Leaderboard, parseConfig, PROBE_TEST, type PullResponse, type Role, STARTERS } from '@galaxy/shared';
import { DEFAULT_CONTENT } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ranking } from '../../src/social/leaderboard';
import { createAdminViaCli, fixedConfig, get, post, put, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// A player's progress edited from the panel (GDD §16.2 «Editar todo»; M6d-4): the gacha luck, a probe's level and
// variant, unlocking a probe, a station room, a Laboratorio node, season points and a galaxy of a chosen type. Each is
// audited; taking something away asks the admin's password. The local database is shared: every test uses its own
// player, and the season is this file's own.

const SEASON = `t-${randomBytes(4).toString('hex')}`;
type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ season: { id: SEASON } }) });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('prg');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  return { cookie, id, username };
}

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

const P = '/galaxy/api/admin/players';
const edit = (username: string, what: string, body: Record<string, unknown>, cookie = admin.cookie) => post(ctx.app, `${P}/${username}/${what}`, { reason: 'Ajuste de prueba', ...body }, { cookie });
const progress = async (username: string) => (await get(ctx.app, `${P}/${username}/progress`, { cookie: admin.cookie })).json() as AdminProgress;
const audits = (target: string, action: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'before', 'after']).where('target_id', '=', target).where('action', '=', action).execute();
const hangar = async (cookie: string) => (await get(ctx.app, '/galaxy/api/hangar', { cookie })).json() as HangarView;

describe('la suerte del gachapón', () => {
  test('se fija por grupo y la siguiente tirada la usa', async () => {
    const p = await player();
    await get(ctx.app, '/galaxy/api/gacha', { cookie: p.cookie });
    const hard = parseConfig('gacha', {}).standard.hard;
    const res = await edit(p.username, 'gacha-luck', { group: 'standard', sinceLegendary: hard - 1, sinceFeatured: 0, welcome: false });
    expect(res.statusCode).toBe(200);
    expect((await progress(p.username)).gacha.find((g) => g.group === 'standard')).toMatchObject({ sinceLegendary: hard - 1, welcome: false });
    const pull = await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 1, pay: 'signal' }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    expect((pull.json() as PullResponse).pulls[0]!.tier).toBe('legendary');
    expect(await audits(p.id, 'player.gacha_luck')).toHaveLength(1);
  });

  test('dos admins a la vez dejan uno de los dos valores y dos filas en la auditoría', async () => {
    const p = await player();
    const other = await staff('admin');
    await Promise.all([
      edit(p.username, 'gacha-luck', { group: 'standard', sinceLegendary: 3, sinceFeatured: 0, welcome: false }),
      edit(p.username, 'gacha-luck', { group: 'standard', sinceLegendary: 7, sinceFeatured: 0, welcome: false }, other.cookie),
    ]);
    expect([3, 7]).toContain((await progress(p.username)).gacha.find((g) => g.group === 'standard')!.sinceLegendary);
    expect(await audits(p.id, 'player.gacha_luck')).toHaveLength(2);
  });
});

describe('las sondas', () => {
  const lumen = DEFAULT_CONTENT.probes.find((p) => p.id === 'lumen')!;
  const variant = DEFAULT_CONTENT.weapons.filter((w) => w.variant?.of === lumen.weapon).sort((a, b) => a.variant!.unlockAt - b.variant!.unlockAt).at(-1)!;

  test('el nivel de una sonda baja y su variante vuelve al arma base', async () => {
    const p = await player();
    const up = await edit(p.username, 'probe', { probe: 'lumen', level: variant.variant!.unlockAt, variant: variant.id });
    expect(up.statusCode).toBe(200);
    let card = (await hangar(p.cookie)).probes.find((x) => x.id === 'lumen')!;
    expect(card).toMatchObject({ level: variant.variant!.unlockAt, variant: variant.id });
    // Lowering takes something away: the password first.
    expect((await edit(p.username, 'probe', { probe: 'lumen', level: 2, variant: null })).statusCode).toBe(401);
    const down = await edit(p.username, 'probe', { probe: 'lumen', level: 2, variant: null, password: admin.password });
    expect(down.statusCode).toBe(200);
    card = (await hangar(p.cookie)).probes.find((x) => x.id === 'lumen')!;
    expect(card).toMatchObject({ level: 2, variant: lumen.weapon });
    expect((await progress(p.username)).probes.find((x) => x.probe === 'lumen')).toMatchObject({ level: 2, variant: null });
  });

  test('una variante que su nivel no abre, o de otra arma, da 400', async () => {
    const p = await player();
    expect((await edit(p.username, 'probe', { probe: 'lumen', level: 1, variant: variant.id })).statusCode).toBe(400);
    const foreign = DEFAULT_CONTENT.weapons.find((w) => w.variant && w.variant.of !== lumen.weapon)!;
    expect((await edit(p.username, 'probe', { probe: 'lumen', level: 10, variant: foreign.id })).statusCode).toBe(400);
  });

  test('desbloquear una sonda la deja elegir en el hangar; bloquearla devuelve el hangar a la del test', async () => {
    const p = await player();
    const locked = DEFAULT_CONTENT.probes.find((x) => !(STARTERS as readonly string[]).includes(x.id))!;
    expect((await put(ctx.app, '/galaxy/api/hangar/probe', { probe: locked.id }, { cookie: p.cookie })).statusCode).toBe(409);
    expect((await edit(p.username, 'probe-grant', { probe: locked.id, granted: true })).statusCode).toBe(200);
    expect((await hangar(p.cookie)).probes.find((x) => x.id === locked.id)!.unlocked).toBe(true);
    expect((await put(ctx.app, '/galaxy/api/hangar/probe', { probe: locked.id }, { cookie: p.cookie })).statusCode).toBe(200);
    expect((await progress(p.username)).probes.find((x) => x.probe === locked.id)).toMatchObject({ unlocked: true, granted: true });
    // Locking it is taking it away: the password, and the hangar goes back to the test's probe.
    expect((await edit(p.username, 'probe-grant', { probe: locked.id, granted: false })).statusCode).toBe(401);
    expect((await edit(p.username, 'probe-grant', { probe: locked.id, granted: false, password: admin.password })).statusCode).toBe(200);
    const h = await hangar(p.cookie);
    expect(h.probe).toBe('lumen');
    expect(h.probes.find((x) => x.id === locked.id)!.unlocked).toBe(false);
    expect((await audits(p.id, 'player.probe_grant')).map((a) => (a.after as { granted: boolean }).granted)).toEqual([true, false]);
  });
});

describe('la estación y el laboratorio', () => {
  test('subir la refinería guarda antes lo refinado a su ritmo de antes', async () => {
    const p = await player();
    await get(ctx.app, '/galaxy/api/station', { cookie: p.cookie });
    const rate = parseConfig('station', {}).refinery[0]!.rate;
    await ctx.db.updateTable('galaxy.refinery').set({ queue: 500, ready: 0, clock: new Date(Date.now() - 3_600_000) }).where('account_id', '=', p.id).execute();
    expect((await edit(p.username, 'room', { room: 'refinery', level: 2 })).statusCode).toBe(200);
    const row = await ctx.db.selectFrom('galaxy.refinery').select(['queue', 'ready']).where('account_id', '=', p.id).executeTakeFirstOrThrow();
    expect(row.ready).toBe(rate);
    expect((await progress(p.username)).rooms.find((r) => r.room === 'refinery')).toMatchObject({ level: 2 });
    // Down again asks the password; a room of a later milestone, or a tool, cannot be edited.
    expect((await edit(p.username, 'room', { room: 'refinery', level: 1 })).statusCode).toBe(401);
    expect((await edit(p.username, 'room', { room: 'refinery', level: 1, password: admin.password })).statusCode).toBe(200);
    expect((await edit(p.username, 'room', { room: 'archive', level: 1 })).json()).toMatchObject({ error: 'room_unavailable' });
    expect((await edit(p.username, 'room', { room: 'scanner', level: 2 })).json()).toMatchObject({ error: 'room_unavailable' });
    expect((await edit(p.username, 'room', { room: 'refinery', level: 99 })).statusCode).toBe(400);
  });

  test('un nodo del laboratorio sube y baja, y a 0 desaparece', async () => {
    const p = await player();
    const node = parseConfig('lab', {}).nodes.find((n) => n.max >= 3)!;
    expect((await edit(p.username, 'lab-node', { node: node.id, level: 3 })).statusCode).toBe(200);
    expect((await progress(p.username)).lab.find((n) => n.node === node.id)).toMatchObject({ level: 3, max: node.max });
    expect((await edit(p.username, 'lab-node', { node: node.id, level: 0, password: admin.password })).statusCode).toBe(200);
    expect((await progress(p.username)).lab.find((n) => n.node === node.id)!.level).toBe(0);
    expect(await ctx.db.selectFrom('galaxy.lab_nodes').select('node').where('account_id', '=', p.id).execute()).toEqual([]);
    expect((await edit(p.username, 'lab-node', { node: 'no-existe', level: 1 })).statusCode).toBe(400);
    expect((await edit(p.username, 'lab-node', { node: node.id, level: node.max + 1 })).statusCode).toBe(400);
  });
});

describe('la temporada', () => {
  test('un ajuste suma en la clasificación General de esa temporada y en ninguna otra', async () => {
    const p = await player();
    expect((await edit(p.username, 'season', { points: 100 })).statusCode).toBe(200);
    const board = (await get(ctx.app, '/galaxy/api/leaderboard?tab=general', { cookie: p.cookie })).json() as Leaderboard;
    expect(board.me).toMatchObject({ username: p.username, value: 100 });
    expect((await progress(p.username)).season).toMatchObject({ id: SEASON, points: 100, adjustments: 100 });
    // Taking points away asks the password, and adds a row (history stays).
    expect((await edit(p.username, 'season', { points: -30 })).statusCode).toBe(401);
    expect((await edit(p.username, 'season', { points: -30, password: admin.password })).statusCode).toBe(200);
    expect((await progress(p.username)).season).toMatchObject({ points: 70, adjustments: 70 });
    const other = await ranking(ctx.db, { ...parseConfig('season', {}), id: `${SEASON}-otra` }, 'general', 60);
    expect(other.some((r) => r.username === p.username)).toBe(false);
  });
});

describe('las galaxias', () => {
  test('dar una galaxia de un tipo da ese tipo', async () => {
    const p = await player();
    const res = await post(ctx.app, `${P}/${p.username}/galaxies`, { tier: 'rare', finish: 'normal', type: 'ring', reason: 'Premio de un evento' }, { cookie: admin.cookie });
    expect(res.statusCode).toBe(200);
    const g = await ctx.db.selectFrom('galaxy.galaxies').select(['traits', 'tier']).where('id', '=', (res.json() as { id: string }).id).executeTakeFirstOrThrow();
    expect((g.traits as { galaxy_type: string }).galaxy_type).toBe('ring');
    expect(g.tier).toBe(2);
    expect((await post(ctx.app, `${P}/${p.username}/galaxies`, { tier: 'rare', finish: 'normal', type: 'no-existe', reason: 'Premio' }, { cookie: admin.cookie })).statusCode).toBe(400);
  });
});

describe('quién', () => {
  test('ni sobre uno mismo ni sobre un superadmin, y un moderador no entra', async () => {
    expect((await edit(admin.username, 'season', { points: 5 })).json()).toMatchObject({ error: 'self_target' });
    const boss = await createAdminViaCli(ctx.db, 'superadmin');
    expect((await edit(boss.username, 'season', { points: 5 })).json()).toMatchObject({ error: 'staff_target' });
    const mod = await staff('moderator');
    const p = await player();
    expect((await edit(p.username, 'season', { points: 5 }, mod.cookie)).statusCode).toBe(403);
    expect((await get(ctx.app, `${P}/${p.username}/progress`, { cookie: mod.cookie })).statusCode).toBe(403);
  });
});
