import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type AdminPlayer, type AdminPlayerList, type AdminSection, type AuditPage, generateGalaxy, type Leaderboard, PROBE_TEST, parseConfig, type Role } from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { invalidateLeaderboard } from '../../src/social/leaderboard';
import { createAdminViaCli, fixedConfig, get, post, put, randomIp, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// The admin panel on the server (GDD §16.1, §16.2; M6a): only admins signed in with TOTP; finding players by name, IP
// or clan; seeing everything about one; changing currency, galaxies, experience and name (each with its ledger and
// audit rows, the destructive ones with the admin's password); reset codes, sessions, bans that also end listings and
// trades, leaderboard exclusion; and the audit log as pages and CSV.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
const now = Date.now();
const season = { id: `adm-${randomUUID().slice(0, 8)}`, name: 'Temporada de admin', startsAt: new Date(now - 86_400_000).toISOString(), endsAt: new Date(now + 86_400_000).toISOString() };
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ season }) });
});
afterAll(() => ctx.close());

const DAY = 86_400_000;
const LEVEL_10 = parseConfig('account', {}).levels[8]!;

async function player(opts: { trader?: boolean; ip?: string; name?: string } = {}) {
  const username = opts.name ?? uniqueName('adp');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' }, { ip: opts.ip ?? randomIp() });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  if (opts.trader) {
    await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: LEVEL_10 }).execute();
    await ctx.db.updateTable('galaxy.accounts').set({ created_at: new Date(now - 4 * DAY) }).where('id', '=', id).execute();
  }
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

let seedCounter = 1n;
async function own(owner: string, tier = 0): Promise<string> {
  const g = generateGalaxy(BigInt(now) * 1000n + 811n + seedCounter++, tier);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier, score: g.score, finish: 'normal', origin: 'grant' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const A = (path: string) => `/galaxy/api/admin${path}`;
const act = (path: string, body: object, cookie = admin.cookie) => post(ctx.app, A(path), body, { cookie });
const view = async (u: string) => (await get(ctx.app, A(`/players/${u}`), { cookie: admin.cookie })).json() as AdminPlayer;
const audits = async (target: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'before', 'after', 'reason']).where('target_id', '=', target).orderBy('id').execute();

describe('quién entra', () => {
  test('un jugador o un moderador no ven ni tocan nada', async () => {
    const p = await player();
    const mod = await staff('moderator');
    for (const cookie of [p.cookie, mod.cookie]) {
      expect((await get(ctx.app, A(`/players?q=${p.username}`), { cookie })).statusCode).toBe(403);
      expect((await act(`/players/${p.username}/wallet`, { currency: 'coins', amount: 500, reason: 'Regalo' }, cookie)).statusCode).toBe(403);
    }
    expect((await get(ctx.app, A('/audit'))).statusCode).toBe(401);
    expect((await getWallet(ctx.db, p.id)).coins).toBe(0);
  });
});

describe('buscar y ver', () => {
  test('por nombre, por IP y por clan; la ficha lo enseña todo', async () => {
    const ip = randomIp();
    const p = await player({ ip, trader: true });
    expect(((await get(ctx.app, A(`/players?q=${p.username.slice(0, 8)}`), { cookie: admin.cookie })).json() as AdminPlayerList).players.map((x) => x.username)).toContain(p.username);
    expect(((await get(ctx.app, A(`/players?q=${ip}`), { cookie: admin.cookie })).json() as AdminPlayerList).players.map((x) => x.username)).toEqual([p.username]);
    await credit(ctx.db, p.id, 'coins', 2000, 'test');
    const tag = randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
    expect((await post(ctx.app, '/galaxy/api/clans', { name: `Admin ${randomUUID().slice(0, 6).replace(/[^a-z]/g, 'x')}`, tag, emblem: 'eye', color: 'ice' }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    expect(((await get(ctx.app, A(`/players?q=${tag}`), { cookie: admin.cookie })).json() as AdminPlayerList).players.map((x) => x.username)).toContain(p.username);

    const v = await view(p.username);
    expect(v).toMatchObject({ username: p.username, level: 10, banned: null, leaderboardExcluded: false, clan: { tag, role: 'leader' }, wallet: { coins: 0 } });
    expect(v.sessions.length).toBeGreaterThan(0);
    expect(v.ips.map((x) => x.ip)).toContain(ip);
    expect((await get(ctx.app, A('/players/no_existe_nadie'), { cookie: admin.cookie })).json()).toEqual({ error: 'player_not_found' });
    const ledger = (await get(ctx.app, A(`/players/${p.username}/ledger`), { cookie: admin.cookie })).json() as AdminSection;
    expect(ledger.rows[0]).toMatchObject({ currency: 'coins', delta: -2000, reason: 'clan_create' });
  });
});

describe('cambiar', () => {
  test('dar monedas deja su asiento y su auditoría; quitar pide la contraseña y nunca baja de 0', async () => {
    const p = await player();
    expect((await act(`/players/${p.username}/wallet`, { currency: 'coins', amount: 500, reason: 'Compensación' })).statusCode).toBe(200);
    expect((await getWallet(ctx.db, p.id)).coins).toBe(500);
    expect((await act(`/players/${p.username}/wallet`, { currency: 'coins', amount: -100, reason: 'Corrección' })).statusCode).toBe(400);
    expect((await act(`/players/${p.username}/wallet`, { currency: 'coins', amount: -100, reason: 'Corrección', password: 'no-es-esa' })).json()).toEqual({ error: 'password_wrong' });
    expect((await act(`/players/${p.username}/wallet`, { currency: 'coins', amount: -900, reason: 'Corrección', password: admin.password })).statusCode).toBe(402);
    expect((await act(`/players/${p.username}/wallet`, { currency: 'coins', amount: -100, reason: 'Corrección', password: admin.password })).statusCode).toBe(200);
    expect((await getWallet(ctx.db, p.id)).coins).toBe(400);
    const rows = await ctx.db.selectFrom('galaxy.ledger').select(['reason', 'delta']).where('account_id', '=', p.id).orderBy('id').execute();
    expect(rows.map((r) => [r.reason, Number(r.delta)])).toEqual([['admin_grant', 500], ['admin_take', -100]]);
    expect((await audits(p.id)).map((a) => a.action)).toEqual(['player.wallet', 'player.wallet']);
  });

  test('conceder una galaxia elegida y retirarla aunque esté equipada', async () => {
    const p = await player();
    const res = await act(`/players/${p.username}/galaxies`, { tier: 'epic', finish: 'holo', reason: 'Premio del torneo' });
    expect(res.statusCode).toBe(200);
    const g = (res.json() as { id: string }).id;
    const row = await ctx.db.selectFrom('galaxy.galaxies').select(['owner_id', 'tier', 'finish', 'origin']).where('id', '=', g).executeTakeFirstOrThrow();
    expect(row).toEqual({ owner_id: p.id, tier: 3, finish: 'holo', origin: 'grant' });
    expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [g, null] }, { cookie: p.cookie })).statusCode).toBe(200);
    expect((await act(`/players/${p.username}/galaxies/${g}/revoke`, { reason: 'Duplicada' })).statusCode).toBe(400);
    expect((await act(`/players/${p.username}/galaxies/${g}/revoke`, { reason: 'Duplicada', password: admin.password })).statusCode).toBe(200);
    expect(await ctx.db.selectFrom('galaxy.loadouts').select('slot').where('galaxy_id', '=', g).executeTakeFirst()).toBeUndefined();
    expect((await ctx.db.selectFrom('galaxy.galaxies').select('disintegrated_at').where('id', '=', g).executeTakeFirstOrThrow()).disintegrated_at).not.toBeNull();
    const revoke = (await audits(p.id)).find((a) => a.action === 'player.galaxy_revoke')!;
    expect(revoke.before).toMatchObject({ galaxy: g, held: ['equipped'] });
  });

  test('retirar una galaxia en venta o en un trueque cierra el anuncio o el trueque', async () => {
    const s = await player({ trader: true });
    const other = await player({ trader: true });
    const [listed, offered] = [await own(s.id), await own(s.id)];
    expect((await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: listed, price: 50 }, { cookie: s.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    expect((await post(ctx.app, '/galaxy/api/trades', { username: other.username, give: { galaxies: [offered], coins: 0 }, want: { galaxies: [], coins: 0 } }, { cookie: s.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    for (const g of [listed, offered]) expect((await act(`/players/${s.username}/galaxies/${g}/revoke`, { reason: 'Revisión', password: admin.password })).statusCode).toBe(200);
    expect((await ctx.db.selectFrom('galaxy.market_listings').select('status').where('galaxy_id', '=', listed).executeTakeFirstOrThrow()).status).toBe('cancelled');
    expect((await ctx.db.selectFrom('galaxy.trades as t').innerJoin('galaxy.trade_items as i', 'i.trade_id', 't.id').select('t.status').where('i.galaxy_id', '=', offered).executeTakeFirstOrThrow()).status).toBe('cancelled');
  });

  test('experiencia y nombre, con contraseña; un nombre ocupado no', async () => {
    const p = await player();
    const taken = await player();
    expect((await act(`/players/${p.username}/xp`, { xp: LEVEL_10, reason: 'Ajuste', password: admin.password })).statusCode).toBe(200);
    expect((await view(p.username)).level).toBe(10);
    expect((await act(`/players/${p.username}/rename`, { username: taken.username, reason: 'Ofensivo', password: admin.password })).json()).toEqual({ error: 'username_taken' });
    const fresh = uniqueName('ren');
    expect((await act(`/players/${p.username}/rename`, { username: fresh, reason: 'Ofensivo', password: admin.password })).statusCode).toBe(200);
    expect((await view(fresh)).id).toBe(p.id);
    expect((await audits(p.id)).map((a) => a.action)).toEqual(['player.xp', 'player.rename']);
  });

  test('diez contraseñas equivocadas cierran la sesión del admin: ni la buena sirve después', async () => {
    const p = await player();
    const guesser = await staff('admin');
    for (let i = 0; i < 10; i++) expect((await act(`/players/${p.username}/xp`, { xp: 1, reason: 'Probar', password: 'mal' }, guesser.cookie)).statusCode).toBe(401);
    expect((await act(`/players/${p.username}/xp`, { xp: 1, reason: 'Probar', password: 'mal' }, guesser.cookie)).statusCode).toBe(429);
    expect((await act(`/players/${p.username}/xp`, { xp: 1, reason: 'Probar', password: guesser.password }, guesser.cookie)).statusCode).toBe(401);
    expect((await get(ctx.app, A('/audit'), { cookie: guesser.cookie })).statusCode).toBe(401);
  });

  test('al equipo solo lo toca un superadmin, a un superadmin nadie desde aquí, y a uno mismo tampoco', async () => {
    const other = await staff('admin');
    const otherId = (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', other.username).executeTakeFirstOrThrow()).id;
    expect((await act(`/players/${other.username}/ban`, { minutes: 60, reason: 'Abuso', password: admin.password })).json()).toEqual({ error: 'staff_target' });
    expect((await act(`/players/${other.username}/sessions/close`, { reason: 'Abuso' })).json()).toEqual({ error: 'staff_target' });
    expect((await act(`/players/${other.username}/reset-code`, { reason: 'Abuso', password: admin.password })).json()).toEqual({ error: 'staff_target' });
    const boss = await staff('superadmin');
    expect((await act(`/players/${boss.username}/rename`, { username: uniqueName('ren'), reason: 'Abuso', password: admin.password })).json()).toEqual({ error: 'staff_target' });
    expect((await act(`/players/${boss.username}/sessions/close`, { reason: 'Prueba' }, other.cookie)).json()).toEqual({ error: 'staff_target' });
    expect((await act(`/players/${other.username}/sessions/close`, { reason: 'Revisión' }, boss.cookie)).statusCode).toBe(200);
    expect((await act(`/players/${admin.username}/wallet`, { currency: 'coins', amount: 1000, reason: 'Para mí' })).json()).toEqual({ error: 'self_target' });
    expect((await getWallet(ctx.db, otherId)).coins).toBe(0);
  });
});

describe('la cuenta', () => {
  test('un código de recuperación se enseña una vez y no queda en la auditoría', async () => {
    const p = await player();
    const res = await act(`/players/${p.username}/reset-code`, { reason: 'Perdió su contraseña', password: admin.password });
    const { code } = res.json() as { code: string };
    expect(code.length).toBeGreaterThan(6);
    expect(JSON.stringify(await audits(p.id))).not.toContain(code);
  });

  test('cerrar sesiones echa al jugador', async () => {
    const p = await player();
    expect((await act(`/players/${p.username}/sessions/close`, { reason: 'Sesión robada' })).statusCode).toBe(200);
    expect((await get(ctx.app, '/galaxy/api/auth/me', { cookie: p.cookie })).statusCode).toBe(401);
  });

  test('banear o cerrar sesiones corta también el socket vivo (y con él, el chat)', async () => {
    for (const path of ['ban', 'sessions/close']) {
      const p = await player();
      const ws = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin: 'http://localhost:5173', cookie: `gs_sid=${p.cookie}` } });
      let closed: number | null = null;
      ws.on('close', (code) => {
        closed = code;
      });
      const body = path === 'ban' ? { minutes: 60, reason: 'Trampas', password: admin.password } : { reason: 'Sesión robada' };
      expect((await act(`/players/${p.username}/${path}`, body)).statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 150));
      expect(closed).toBe(4401);
    }
  });

  test('banear cierra sesiones y cancela anuncios, ofertas y trueques; desbanear lo levanta', async () => {
    const s = await player({ trader: true });
    const other = await player({ trader: true });
    const [g1, g2, g3] = [await own(s.id), await own(s.id), await own(other.id)];
    await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: g1, price: 50 }, { cookie: s.cookie, headers: { 'idempotency-key': randomUUID() } });
    await post(ctx.app, '/galaxy/api/trades', { username: other.username, give: { galaxies: [g2], coins: 0 }, want: { galaxies: [], coins: 0 } }, { cookie: s.cookie, headers: { 'idempotency-key': randomUUID() } });
    // An offer of theirs on someone else's listing: its coins come back with the ban.
    await credit(ctx.db, s.id, 'coins', 500, 'test');
    const listing = (await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: g3, price: 400 }, { cookie: other.cookie, headers: { 'idempotency-key': randomUUID() } })).json() as { id: string };
    expect((await post(ctx.app, `/galaxy/api/market/listings/${listing.id}/offers`, { amount: 200 }, { cookie: s.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    expect((await getWallet(ctx.db, s.id)).coins).toBe(300);
    expect((await act(`/players/${s.username}/ban`, { minutes: null, reason: 'Trampas' })).statusCode).toBe(400);
    expect((await act(`/players/${s.username}/ban`, { minutes: null, reason: 'Trampas', password: admin.password })).statusCode).toBe(200);
    expect((await get(ctx.app, '/galaxy/api/auth/me', { cookie: s.cookie })).statusCode).toBe(401);
    expect((await ctx.db.selectFrom('galaxy.market_listings').select('status').where('galaxy_id', '=', g1).executeTakeFirstOrThrow()).status).toBe('cancelled');
    expect((await ctx.db.selectFrom('galaxy.trades as t').innerJoin('galaxy.trade_items as i', 'i.trade_id', 't.id').select('t.status').where('i.galaxy_id', '=', g2).executeTakeFirstOrThrow()).status).toBe('cancelled');
    expect((await ctx.db.selectFrom('galaxy.market_offers').select('status').where('listing_id', '=', listing.id).executeTakeFirstOrThrow()).status).toBe('closed');
    expect((await getWallet(ctx.db, s.id)).coins).toBe(500);
    expect((await view(s.username)).banned).toMatchObject({ permanent: true });
    expect((await act(`/players/${s.username}/unban`, { reason: 'Recurso aceptado' })).statusCode).toBe(200);
    expect((await view(s.username)).banned).toBeNull();
  });

  test('excluir de la clasificación lo saca de ella', async () => {
    const p = await player();
    await ctx.db
      .insertInto('galaxy.runs')
      .values({ account_id: p.id, seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: '[]', content_version: 0, sim_version: SIM_VERSION, start_key: randomUUID(), started_at: new Date(), finished_at: new Date(), outcome: 'died', ticks: 36_000, depth: 32_000, kills: 10, boss_kills: 0, level: 3, seconds: 600, hash: '0123456789abcdef', payout: '{}', runs_version: 0, flags: [], suspicious: false })
      .execute();
    invalidateLeaderboard();
    const depth = async () => ((await get(ctx.app, '/galaxy/api/leaderboard?tab=depth', { cookie: p.cookie })).json() as Leaderboard).rows.map((r) => r.username);
    expect(await depth()).toContain(p.username);
    expect((await act(`/players/${p.username}/leaderboard`, { excluded: true, reason: 'Partidas raras' })).statusCode).toBe(200);
    expect(await depth()).not.toContain(p.username);
    expect((await view(p.username)).leaderboardExcluded).toBe(true);
  });
});

describe('la auditoría', () => {
  test('se filtra por quién y qué, y se exporta a CSV', async () => {
    const p = await player();
    await act(`/players/${p.username}/wallet`, { currency: 'dust', amount: 50, reason: 'Para el CSV' });
    const page = (await get(ctx.app, A(`/audit?actor=${admin.username}&action=player.wallet`), { cookie: admin.cookie })).json() as AuditPage;
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((r) => r.actor === admin.username && r.action === 'player.wallet')).toBe(true);
    expect(page.rows[0]).toMatchObject({ targetId: p.id, reason: 'Para el CSV' });
    const csv = await get(ctx.app, A(`/audit?format=csv&actor=${admin.username}`), { cookie: admin.cookie });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.replace(/^\uFEFF/, '').split('\n')[0]).toBe('fecha,quien,accion,tipo,objetivo,motivo,ip,antes,despues');
    expect(csv.body).toContain('Para el CSV');
    // A reason that a spreadsheet would run as a formula is written as text.
    const q = await player();
    await act(`/players/${q.username}/wallet`, { currency: 'dust', amount: 1, reason: '=HYPERLINK("https://x.example","clic")' });
    const evil = await get(ctx.app, A(`/audit?format=csv&target=${q.id}`), { cookie: admin.cookie });
    expect(evil.body).toContain(`"'=HYPERLINK(""https://x.example"",""clic"")"`);
  });
});

// Plan «escáner pro», part F: the whole list with nothing typed, 50 a page, with its filters and order; and «Eliminar»,
// which anonymises and closes an account (its history stays, its personal and social data go).
const list = async (query: string, cookie = admin.cookie) => {
  const res = await get(ctx.app, A(`/players${query}`), { cookie });
  expect(res.statusCode).toBe(200);
  return res.json() as AdminPlayerList;
};
const names = async (query: string) => (await list(query)).players.map((x) => x.username);
const idOf = async (username: string) => (await ctx.db.selectFrom('galaxy.accounts').select('id').where('username', '=', username).executeTakeFirstOrThrow()).id;

describe('la lista', () => {
  test('sin texto salen todos, de 50 en 50, con el total y las páginas', async () => {
    await player();
    const all = await list('');
    expect(all.total).toBeGreaterThan(0);
    expect(all.players.length).toBe(Math.min(50, all.total));
    expect(all).toMatchObject({ page: 1, pages: Math.max(1, Math.ceil(all.total / 50)) });
    expect(all.players[0]).toHaveProperty('online');
    expect(all.players[0]).toHaveProperty('muted');
    expect(all.players[0]).toMatchObject({ deletedAt: null });
    expect((await get(ctx.app, A('/players?state=nadie'), { cookie: admin.cookie })).statusCode).toBe(400);
  });

  test('el texto busca dentro del nombre, con los que empiezan por él primero; se ordena y se pagina', async () => {
    const t = `k${randomBytes(3).toString('hex')}`;
    const [x, y, z] = [`a${t}x`, `${t}b`, `c${t}`];
    const px = await player({ name: x });
    const py = await player({ name: y });
    await player({ name: z, trader: true });
    expect(await names(`?q=${t}&sort=name&dir=desc`)).toEqual([y, z, x]);
    expect(await names(`?q=${t}&sort=name&dir=asc`)).toEqual([y, x, z]);
    expect(await names(`?q=${t}&sort=level&dir=desc`)).toEqual([y, z, x]);
    expect((await list(`?q=${t}&page=2`)).players).toEqual([]);
    expect((await list(`?q=${t}&page=2`)).total).toBe(3);

    await ctx.db.updateTable('galaxy.sessions').set({ last_seen_at: new Date(now - 10 * DAY) }).where('account_id', '=', px.id).execute();
    expect(await names(`?q=${t}&state=active&sort=name&dir=asc`)).toEqual([y, z]);
    expect((await act(`/players/${z}/ban`, { minutes: 60, reason: 'Trampas', password: admin.password })).statusCode).toBe(200);
    expect(await names(`?q=${t}&state=banned`)).toEqual([z]);
    await ctx.db.insertInto('galaxy.chat_mutes').values({ account_id: py.id, until: new Date(now + DAY), reason: 'Insultos' }).execute();
    expect(await names(`?q=${t}&state=muted`)).toEqual([y]);
    expect((await list(`?q=${y}`)).players[0]).toMatchObject({ username: y, muted: true, banned: false });
    expect(await names(`?q=${admin.username}&state=staff`)).toEqual([admin.username]);
    expect(await names(`?q=${t}&state=staff`)).toEqual([]);
  });

  test('conectados ahora: los que tienen el directo abierto', async () => {
    const p = await player();
    expect(await names(`?q=${p.username}&state=online`)).toEqual([]);
    const ws = await ctx.app.injectWS('/galaxy/api/live/ws', { headers: { origin: 'http://localhost:5173', cookie: `gs_sid=${p.cookie}` } });
    await new Promise((r) => setTimeout(r, 100));
    expect(await names(`?q=${p.username}&state=online`)).toEqual([p.username]);
    expect((await list(`?q=${p.username}`)).players[0]!.online).toBe(true);
    ws.terminate();
  });
});

describe('eliminar', () => {
  const del = (u: string, body: object, cookie = admin.cookie) => act(`/players/${u}/delete`, { reason: 'Lo pidió el jugador', password: admin.password, confirm: u, ...body }, cookie);
  const count = async (table: 'galaxy.sessions' | 'galaxy.account_ips' | 'galaxy.clan_members' | 'galaxy.ledger', id: string) =>
    Number((await ctx.db.selectFrom(table).select(ctx.db.fn.countAll<number>().as('n')).where('account_id', '=', id).executeTakeFirstOrThrow()).n);

  test('pide la contraseña y el nombre escrito; deja la cuenta anónima, cerrada y sin datos sociales', async () => {
    const p = await player({ trader: true });
    const heir = await player({ trader: true });
    const friend = await player({ trader: true });
    await credit(ctx.db, p.id, 'coins', 3000, 'test');
    const tag = randomInt(36 ** 3, 36 ** 4).toString(36).toUpperCase();
    expect((await post(ctx.app, '/galaxy/api/clans', { name: `Borrar ${randomUUID().slice(0, 6).replace(/[^a-z]/g, 'x')}`, tag, emblem: 'eye', color: 'ice' }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    const clan = await ctx.db.selectFrom('galaxy.clans').select('id').where('tag', '=', tag).executeTakeFirstOrThrow();
    await ctx.db.insertInto('galaxy.clan_members').values({ clan_id: clan.id, account_id: heir.id, role: 'member' }).execute();
    const [g1, g2] = [await own(p.id), await own(p.id)];
    await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: g1, price: 50 }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    await post(ctx.app, '/galaxy/api/trades', { username: friend.username, give: { galaxies: [g2], coins: 0 }, want: { galaxies: [], coins: 0 } }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
    const [lo, hi] = p.id < friend.id ? [p.id, friend.id] : [friend.id, p.id];
    await ctx.db.insertInto('galaxy.friendships').values({ a: lo, b: hi, status: 'accepted', requested_by: p.id, accepted_at: new Date() }).execute();
    await ctx.db.insertInto('galaxy.chat_messages').values({ author_id: p.id, channel: 'global', body: 'hola a todos' }).execute();
    const ledger = await count('galaxy.ledger', p.id);
    expect(await count('galaxy.account_ips', p.id)).toBeGreaterThan(0);
    expect((await put(ctx.app, '/galaxy/api/settings', { v: 1, muted: true }, { cookie: p.cookie })).statusCode).toBe(200);

    expect((await del(p.username, { confirm: 'otro_nombre' })).json()).toEqual({ error: 'confirm_mismatch' });
    expect((await del(p.username, { password: 'no-es-la-clave' })).json()).toEqual({ error: 'password_wrong' });
    const res = await del(p.username, {});
    expect(res.statusCode).toBe(200);
    const anon = (res.json() as { username: string }).username;
    expect(anon).toMatch(/^borrado_[0-9a-f]{8}$/);

    expect((await get(ctx.app, '/galaxy/api/auth/me', { cookie: p.cookie })).statusCode).toBe(401);
    expect((await post(ctx.app, '/galaxy/api/auth/login', { username: p.username, password: 'una-clave-larga' })).statusCode).toBe(401);
    expect((await post(ctx.app, '/galaxy/api/auth/login', { username: anon, password: 'una-clave-larga' })).statusCode).not.toBe(200);
    expect((await get(ctx.app, A(`/players/${p.username}`), { cookie: admin.cookie })).json()).toEqual({ error: 'player_not_found' });
    expect((await get(ctx.app, `/galaxy/api/profiles/${anon}`, { cookie: friend.cookie })).json()).toEqual({ error: 'profile_not_found' });

    const row = await ctx.db.selectFrom('galaxy.accounts').selectAll().where('id', '=', p.id).executeTakeFirstOrThrow();
    expect(row.deleted_at).not.toBeNull();
    expect(new Date(row.banned_until!).getUTCFullYear()).toBe(9999);
    expect(row).toMatchObject({ username: anon, leaderboard_excluded: true, title: null, frame: null, avatar: null, banner: null });
    expect(await count('galaxy.sessions', p.id)).toBe(0);
    expect(await count('galaxy.account_ips', p.id)).toBe(0);
    expect(await count('galaxy.clan_members', p.id)).toBe(0);
    expect(await ctx.db.selectFrom('galaxy.chat_messages').select('id').where('author_id', '=', p.id).execute()).toEqual([]);
    expect(await ctx.db.selectFrom('galaxy.friendships').select('a').where((eb) => eb.or([eb('a', '=', p.id), eb('b', '=', p.id)])).execute()).toEqual([]);
    expect((await ctx.db.selectFrom('galaxy.clan_members').select('role').where('account_id', '=', heir.id).executeTakeFirstOrThrow()).role).toBe('leader');
    expect((await ctx.db.selectFrom('galaxy.market_listings').select('status').where('galaxy_id', '=', g1).executeTakeFirstOrThrow()).status).toBe('cancelled');
    expect((await ctx.db.selectFrom('galaxy.trades as t').innerJoin('galaxy.trade_items as i', 'i.trade_id', 't.id').select('t.status').where('i.galaxy_id', '=', g2).executeTakeFirstOrThrow()).status).toBe('cancelled');
    expect(await count('galaxy.ledger', p.id)).toBe(ledger);
    expect(await ctx.db.selectFrom('galaxy.settings').select('account_id').where('account_id', '=', p.id).executeTakeFirst()).toBeUndefined();

    const audit = (await audits(p.id)).find((x) => x.action === 'player.delete')!;
    expect(audit).toMatchObject({ reason: 'Lo pidió el jugador', before: { username: p.username }, after: { username: anon, reserved: false } });
    expect(await names(`?q=${anon}&state=deleted`)).toEqual([anon]);
    expect(await names(`?q=${anon}`)).toEqual([]);
    expect((await del(anon, {})).json()).toEqual({ error: 'player_deleted' });

    // Its name is free again.
    expect((await post(ctx.app, '/galaxy/api/auth/register', { username: p.username, password: 'otra-clave-larga' }, { ip: randomIp() })).statusCode).toBe(201);
  });

  test('«Reservar el nombre» lo deja sin usar', async () => {
    const p = await player();
    expect((await del(p.username, { reserveName: true })).statusCode).toBe(200);
    const again = await post(ctx.app, '/galaxy/api/auth/register', { username: p.username, password: 'otra-clave-larga' }, { ip: randomIp() });
    expect(again.statusCode).toBe(409);
  });

  test('al equipo solo un superadmin, a uno mismo nadie, y un moderador no puede', async () => {
    const other = await staff('admin');
    const otherId = await idOf(other.username);
    expect((await del(other.username, {})).json()).toEqual({ error: 'staff_target' });
    expect((await del(admin.username, {})).json()).toEqual({ error: 'self_target' });
    const mod = await staff('moderator');
    const p = await player();
    expect((await del(p.username, {}, mod.cookie)).statusCode).toBe(403);
    const boss = await staff('superadmin');
    expect((await del(other.username, { password: boss.password }, boss.cookie)).statusCode).toBe(200);
    expect(await ctx.db.selectFrom('galaxy.account_roles').select('role').where('account_id', '=', otherId).execute()).toEqual([]);
  });
});
