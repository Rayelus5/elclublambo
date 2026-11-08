import { randomUUID } from 'node:crypto';
import { type AdminStats, commissionOf, generateGalaxy, parseConfig, PROBE_TEST, type Role } from '@galaxy/shared';
import { ENGINE_VERSION } from '@galaxy/engine';
import { SIM_VERSION } from '@galaxy/sim';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, debit } from '../../src/economy/wallet';
import { statsCsv } from '../../src/admin/stats';
import { createAdminViaCli, fixedConfig, get, post, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Live statistics on the server (GDD §16.6; M6d-2), for admins only. The local database is shared with every other test
// and the owner's own play, so each test reads the statistics, acts, reads them again and checks what it added.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({}) });
});
afterAll(() => ctx.close());

async function player() {
  const username = uniqueName('sta');
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
  return { cookie: sessionCookie(res), username };
}
let admin: Awaited<ReturnType<typeof staff>>;
beforeAll(async () => {
  admin = await staff('admin');
});

const stats = async (period = '24h') => (await get(ctx.app, `/galaxy/api/admin/stats?period=${period}`, { cookie: admin.cookie })).json() as AdminStats;
const flow = (s: AdminStats, currency: string, reason: string) => s.currencies.find((c) => c.currency === currency)?.byReason.find((r) => r.reason === reason) ?? { reason, in: 0, out: 0 };

describe('quién entra', () => {
  test('un jugador o un moderador no ven las estadísticas; un periodo o una sección malos dan 400', async () => {
    const p = await player();
    const mod = await staff('moderator');
    for (const cookie of [p.cookie, mod.cookie]) {
      expect((await get(ctx.app, '/galaxy/api/admin/stats', { cookie })).statusCode).toBe(403);
      expect((await get(ctx.app, '/galaxy/api/admin/stats.csv?section=runs', { cookie })).statusCode).toBe(403);
    }
    expect((await get(ctx.app, '/galaxy/api/admin/stats?period=1y', { cookie: admin.cookie })).statusCode).toBe(400);
    expect((await get(ctx.app, '/galaxy/api/admin/stats.csv?section=gems', { cookie: admin.cookie })).statusCode).toBe(400);
  });
});

describe('las cifras', () => {
  test('las últimas 24 horas van por horas, 24 casillas aunque estén vacías; 7 y 30 días, por días', async () => {
    const day = await stats('24h');
    expect(day.runs.buckets).toHaveLength(24);
    expect(day.runs.buckets.every((b) => Number.isInteger(b.count) && b.count >= 0)).toBe(true);
    expect((await stats('7d')).runs.buckets).toHaveLength(7);
    expect((await stats('30d')).runs.buckets).toHaveLength(30);
  });

  test('un jugador conectado, una cuenta nueva y una partida suman donde toca', async () => {
    const before = await stats();
    const p = await player();
    await ctx.db
      .insertInto('galaxy.runs')
      .values({ account_id: p.id, seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: '[]', content_version: 0, sim_version: SIM_VERSION, start_key: randomUUID(), started_at: new Date(), finished_at: new Date(), outcome: 'extracted', ticks: 600, depth: 10, kills: 1, boss_kills: 0, level: 1, seconds: 10, hash: '0123456789abcdef', payout: '{}', runs_version: 0, flags: [], suspicious: false })
      .execute();
    const after = await stats();
    expect(after.players.online).toBeGreaterThanOrEqual(1);
    expect(after.players.newAccounts).toBeGreaterThan(before.players.newAccounts);
    expect(after.runs.buckets.at(-1)!.count).toBeGreaterThan(before.runs.buckets.at(-1)!.count);
    expect(after.runs.outcomes.extracted).toBeGreaterThan(before.runs.outcomes.extracted);
  });

  test('una entrada y una salida de monedas salen por su motivo', async () => {
    const p = await player();
    const reason = `stats_${randomUUID().slice(0, 8)}`;
    await credit(ctx.db, p.id, 'coins', 700, reason);
    await debit(ctx.db, p.id, 'coins', 200, reason);
    const s = await stats();
    expect(flow(s, 'coins', reason)).toEqual({ reason, in: 700, out: 200 });
    const coins = s.currencies.find((c) => c.currency === 'coins')!;
    expect(coins.in).toBeGreaterThanOrEqual(700);
    expect(coins.out).toBeGreaterThanOrEqual(200);
  });

  test('una tirada cuenta en su rareza, y lo esperado viene de la configuración y suma 1', async () => {
    const before = await stats();
    const p = await player();
    expect((await post(ctx.app, '/galaxy/api/gacha/pull', { banner: 'deep-scan', count: 1, pay: 'signal' }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    const after = await stats();
    expect(after.pulls.total).toBeGreaterThan(before.pulls.total);
    expect(after.pulls.tiers).toHaveLength(5);
    expect(after.pulls.tiers.reduce((n, t) => n + t.expected, 0)).toBeCloseTo(1, 5);
    expect(after.pulls.tiers.reduce((n, t) => n + t.count, 0)).toBe(after.pulls.total);
  });

  test('lo pendiente de revisar está en su sitio', async () => {
    const s = await stats();
    expect(s.pending.alerts).toBeGreaterThanOrEqual(0);
    expect(s.pending.reports).toBeGreaterThanOrEqual(0);
  });
});

describe('CSV', () => {
  test('cada sección sale con su cabecera y sus filas, y el texto con comas va entre comillas', async () => {
    const res = await get(ctx.app, '/galaxy/api/admin/stats.csv?period=7d&section=runs', { cookie: admin.cookie });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="estadisticas-runs-7d-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toBe('dia,partidas');
    expect(lines).toHaveLength(8);
    const fake: AdminStats = {
      period: '24h',
      from: '2026-11-07T12:00:00.000Z',
      to: '2026-11-08T12:00:00.000Z',
      players: { online: 0, sockets: 0, newAccounts: 0, activeAccounts: 0 },
      runs: { buckets: [], outcomes: { extracted: 0, died: 0, abandoned: 0, open: 0, unfinished: 0 } },
      currencies: [{ currency: 'coins', in: 1_500_000, out: 20, byReason: [{ reason: 'a,b "c"', in: 1_500_000, out: 20 }] }],
      pulls: { total: 0, tiers: [0, 1, 2, 3, 4].map((tier) => ({ tier, count: 0, expected: 0.2 })) },
      market: { listed: 0, sold: 0, coins: 0, commission: 0, tradesDone: 0, tradesCancelled: 0 },
      pending: { alerts: 0, reports: 0 },
    };
    expect(statsCsv(fake, 'currencies').trim().split('\n')).toEqual(['moneda,motivo,entra,sale', 'coins,"a,b ""c""",1500000,20']);
    expect(statsCsv(fake, 'pulls').trim().split('\n')[1]).toBe('comun,0,0.2');
  });
});

describe('revisión final', () => {
  test('la ventana de 24 horas empieza donde empieza su primera barra', async () => {
    const s = await stats('24h');
    expect(s.from).toBe(s.runs.buckets[0]!.at);
    expect(Date.parse(s.to) - Date.parse(s.from)).toBeLessThanOrEqual(86_400_000);
  });

  test('un jugador cuya sesión se vio hace 7 minutos sigue contando como conectado', async () => {
    const p = await player();
    const at = (min: number) => ctx.db.updateTable('galaxy.sessions').set({ last_seen_at: new Date(Date.now() - min * 60_000) }).where('account_id', '=', p.id).execute();
    await at(12);
    const away = (await stats()).players.online;
    await at(7);
    expect((await stats()).players.online).toBeGreaterThan(away);
  });

  test('una partida sin terminar que ya caducó no cuenta como en curso', async () => {
    const before = await stats('7d');
    const p = await player();
    await ctx.db
      .insertInto('galaxy.runs')
      .values({ account_id: p.id, seed: '1', sector: 'outer-nebula', probe: 'lumen', relics: '[]', content_version: 0, sim_version: SIM_VERSION, start_key: randomUUID(), started_at: new Date(Date.now() - 30 * 3_600_000), flags: [], suspicious: false })
      .execute();
    const after = await stats('7d');
    expect(after.runs.outcomes.unfinished).toBeGreaterThan(before.runs.outcomes.unfinished);
    expect(after.runs.outcomes.open).toBe(before.runs.outcomes.open);
  });

  test('una venta suma una venta, su precio y su comisión', async () => {
    const DAY = 86_400_000;
    const LEVEL_10 = parseConfig('account', {}).levels[8]!;
    const trader = async () => {
      const p = await player();
      await ctx.db.insertInto('galaxy.account_xp').values({ account_id: p.id, xp: LEVEL_10 }).execute();
      await ctx.db.updateTable('galaxy.accounts').set({ created_at: new Date(Date.now() - 4 * DAY) }).where('id', '=', p.id).execute();
      return p;
    };
    const [seller, buyer] = await Promise.all([trader(), trader()]);
    const g = generateGalaxy(BigInt(Date.now()) * 1000n + 4242n, 0);
    const galaxy = await ctx.db
      .insertInto('galaxy.galaxies')
      .values({ owner_id: seller.id, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier: 0, score: g.score, finish: 'normal', origin: 'grant' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const before = await stats();
    const listed = await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: galaxy.id, price: 600 }, { cookie: seller.cookie, headers: { 'idempotency-key': randomUUID() } });
    expect(listed.statusCode).toBe(200);
    await credit(ctx.db, buyer.id, 'coins', 600, 'test');
    expect((await post(ctx.app, `/galaxy/api/market/listings/${(listed.json() as { id: string }).id}/buy`, undefined, { cookie: buyer.cookie, headers: { 'idempotency-key': randomUUID() } })).statusCode).toBe(200);
    const after = await stats();
    expect(after.market.listed - before.market.listed).toBeGreaterThanOrEqual(1);
    expect(after.market.sold - before.market.sold).toBeGreaterThanOrEqual(1);
    expect(after.market.coins - before.market.coins).toBeGreaterThanOrEqual(600);
    expect(after.market.commission - before.market.commission).toBeGreaterThanOrEqual(commissionOf(600, parseConfig('market', {}).commission));
  });
});
