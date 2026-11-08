import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { generateGalaxy, type MyTrades, PROBE_TEST, parseConfig, TIERS, type Tier, type TradeView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fixedConfig, get, post, put, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

// Swaps on the server (GDD §14.5, §14.7; M5c-2): one galaxy for one galaxy. What a side offers stays in escrow; every
// change is a new version, and the swap runs when both confirmed the same one. The trade gates, open and daily limits,
// expiry and the alerts for the admin. Every account and galaxy here is new.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ market: { openTrades: 2, perDay: { listings: 10, purchases: 10, trades: 3 } } }) });
});
afterAll(() => ctx.close());

const DAY = 86_400_000;
const LEVEL_10 = parseConfig('account', {}).levels[8]!;

async function player(opts: { level10?: boolean; ip?: string } = {}) {
  const { level10 = true, ip = randomIp() } = opts;
  const username = uniqueName('trd');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' }, { ip });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  if (level10) await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: LEVEL_10 }).execute();
  await ctx.db.updateTable('galaxy.accounts').set({ created_at: new Date(Date.now() - 4 * DAY) }).where('id', '=', id).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

let seedCounter = 1n;
async function own(owner: string, tier: Tier = 'common'): Promise<string> {
  const t = TIERS.indexOf(tier);
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 677n + seedCounter++, t);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier: t, score: g.score, finish: 'normal', origin: 'grant' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const propose = (p: P, username: string, give: string, want?: string) =>
  post(ctx.app, '/galaxy/api/trades', { username, give, ...(want ? { want } : {}) }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
const offer = (p: P, id: string, body: { give: string | null; want: string | null; version: number }) => post(ctx.app, `/galaxy/api/trades/${id}/offer`, body, { cookie: p.cookie });
const confirm = (p: P, id: string, version: number) => post(ctx.app, `/galaxy/api/trades/${id}/confirm`, { version }, { cookie: p.cookie });
const cancel = (p: P, id: string) => post(ctx.app, `/galaxy/api/trades/${id}/cancel`, undefined, { cookie: p.cookie });
const mine = async (p: P) => (await get(ctx.app, '/galaxy/api/trades', { cookie: p.cookie })).json() as MyTrades;
const ownerOf = async (g: string) => (await ctx.db.selectFrom('galaxy.galaxies').select('owner_id').where('id', '=', g).executeTakeFirstOrThrow()).owner_id;
const equip = (p: P, g: string) => put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [g, null] }, { cookie: p.cookie });

async function pair() {
  const a = await player();
  const b = await player();
  const [ga, gb] = [await own(a.id), await own(b.id, 'uncommon')];
  return { a, b, ga, gb };
}

describe('proponer', () => {
  test('doy una galaxia y pido una del otro: queda la versión 1, confirmada por quien propone', async () => {
    const { a, b, ga, gb } = await pair();
    const res = await propose(a, b.username, ga, gb);
    expect(res.statusCode).toBe(200);
    const t = res.json() as TradeView;
    expect(t).toMatchObject({ version: 1, status: 'open', proposedByMe: true, me: { galaxy: { id: ga }, confirmed: true }, them: { username: b.username, galaxy: { id: gb }, confirmed: false } });
    const seen = (await mine(b)).open.find((x) => x.id === t.id)!;
    expect(seen).toMatchObject({ proposedByMe: false, me: { galaxy: { id: gb }, confirmed: false }, them: { username: a.username, galaxy: { id: ga }, confirmed: true } });
  });

  test('sin pedir nada nadie puede confirmar todavía', async () => {
    const { a, b, ga } = await pair();
    const t = (await propose(a, b.username, ga)).json() as TradeView;
    expect(t.me.confirmed).toBe(false);
    expect((await confirm(b, t.id, 1)).json()).toEqual({ error: 'trade_incomplete' });
  });

  test('lo ofrecido queda en depósito; lo pedido no', async () => {
    const { a, b, ga, gb } = await pair();
    await propose(a, b.username, ga, gb);
    expect((await equip(a, ga)).json()).toEqual({ error: 'galaxy_in_trade' });
    expect((await post(ctx.app, '/galaxy/api/market/listings', { galaxyId: ga, price: 50 }, { cookie: a.cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'galaxy_in_trade' });
    expect((await post(ctx.app, `/galaxy/api/galaxies/${ga}/disintegrate`, undefined, { cookie: a.cookie, headers: { 'idempotency-key': randomUUID() } })).json()).toEqual({ error: 'galaxy_in_trade' });
    expect((await propose(a, (await player()).username, ga)).json()).toEqual({ error: 'galaxy_in_trade' });
    // What A only asked for is still B's to use.
    expect((await equip(b, gb)).statusCode).toBe(200);
  });

  test('ni conmigo, ni lo equipado, ni lo ajeno, ni sin las reglas', async () => {
    const { a, b, ga } = await pair();
    expect((await propose(a, a.username, ga)).json()).toEqual({ error: 'trade_self' });
    const eq = await own(a.id);
    expect((await equip(a, eq)).statusCode).toBe(200);
    expect((await propose(a, b.username, eq)).json()).toEqual({ error: 'galaxy_equipped' });
    expect((await propose(a, b.username, await own(b.id))).json()).toEqual({ error: 'galaxy_not_found' });
    expect((await propose(a, b.username, ga, await own(a.id))).json()).toEqual({ error: 'galaxy_not_found' });
    const low = await player({ level10: false });
    expect((await propose(low, b.username, await own(low.id))).json()).toEqual({ error: 'trade_level' });
  });

  test('los abiertos y los del día tienen límite', async () => {
    const a = await player();
    const [b1, b2, b3] = [await player(), await player(), await player()];
    const t1 = (await propose(a, b1.username, await own(a.id))).json() as TradeView;
    expect((await propose(a, b2.username, await own(a.id))).statusCode).toBe(200);
    expect((await propose(a, b3.username, await own(a.id))).json()).toEqual({ error: 'trade_limit' });
    await cancel(a, t1.id);
    const t3 = (await propose(a, b3.username, await own(a.id))).json() as TradeView;
    await cancel(a, t3.id);
    // Two open at most; three proposals a day (the cancelled ones count, the refused one does not).
    const t4 = await propose(a, b1.username, await own(a.id));
    expect(t4.statusCode).toBe(429);
    expect(t4.json()).toEqual({ error: 'trade_daily_cap' });
  });
});

describe('cambiar y confirmar', () => {
  test('el otro confirma la misma versión y se intercambian, con su nivel', async () => {
    const { a, b, ga, gb } = await pair();
    await ctx.db.updateTable('galaxy.galaxies').set({ level: 3, featured: true }).where('id', '=', ga).execute();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const done = (await confirm(b, t.id, 1)).json() as TradeView;
    expect(done).toMatchObject({ status: 'done', me: { confirmed: true }, them: { confirmed: true } });
    expect(await ownerOf(ga)).toBe(b.id);
    expect(await ownerOf(gb)).toBe(a.id);
    const moved = await ctx.db.selectFrom('galaxy.galaxies').select(['level', 'featured']).where('id', '=', ga).executeTakeFirstOrThrow();
    expect(moved).toEqual({ level: 3, featured: true });
    expect((await mine(a)).closed.map((x) => x.id)).toContain(t.id);
    // Free again in their new hands.
    expect((await equip(b, ga)).statusCode).toBe(200);
  });

  test('un cambio es otra versión: la confirmación vieja no vale y quien cambia confirma la nueva', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const other = await own(b.id, 'rare');
    const v2 = (await offer(b, t.id, { give: other, want: ga, version: 1 })).json() as TradeView;
    expect(v2).toMatchObject({ version: 2, me: { galaxy: { id: other }, confirmed: true }, them: { confirmed: false } });
    // B's new offer is in escrow now; the one A asked for first is free.
    expect((await equip(b, other)).json()).toEqual({ error: 'galaxy_in_trade' });
    expect((await equip(b, gb)).statusCode).toBe(200);
    expect((await confirm(a, t.id, 1)).json()).toEqual({ error: 'trade_changed' });
    expect((await offer(a, t.id, { give: ga, want: other, version: 1 })).json()).toEqual({ error: 'trade_changed' });
    expect(((await confirm(a, t.id, 2)).json() as TradeView).status).toBe('done');
    expect(await ownerOf(other)).toBe(a.id);
  });

  test('si lo pedido ya no está libre al confirmar, se dice', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    expect((await equip(b, gb)).statusCode).toBe(200);
    expect((await confirm(b, t.id, 1)).json()).toEqual({ error: 'galaxy_equipped' });
    expect(await ownerOf(ga)).toBe(a.id);
  });

  test('cambiar mientras el otro confirma: nunca las dos cosas', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const [c, o] = await Promise.all([confirm(b, t.id, 1), offer(a, t.id, { give: ga, want: null, version: 1 })]);
    expect([c.statusCode, o.statusCode].sort()).toEqual([200, 409]);
    const swapped = (await ownerOf(ga)) === b.id;
    expect(swapped).toBe(c.statusCode === 200);
  });

  test('cancelar mientras el otro confirma: gana uno y el depósito se libera si no hubo trato', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const [x, y] = await Promise.all([cancel(a, t.id), confirm(b, t.id, 1)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    if (x.statusCode === 200) expect((await equip(a, ga)).statusCode).toBe(200);
    else expect(await ownerOf(ga)).toBe(b.id);
  });

  test('caducado ya no se confirma y libera lo ofrecido', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    await ctx.db.updateTable('galaxy.trades').set({ expires_at: new Date(Date.now() - 1000), created_at: new Date(Date.now() - 2000) }).where('id', '=', t.id).execute();
    expect((await confirm(b, t.id, 1)).json()).toEqual({ error: 'trade_gone' });
    expect((await equip(a, ga)).statusCode).toBe(200);
  });

  test('con una parte baneada no hay trato', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    await ctx.db.updateTable('galaxy.accounts').set({ banned_until: new Date(Date.now() + DAY) }).where('id', '=', a.id).execute();
    expect((await confirm(b, t.id, 1)).json()).toEqual({ error: 'trade_gone' });
    expect(await ownerOf(gb)).toBe(b.id);
  });

  test('un extraño no ve ni toca un trueque ajeno', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const c = await player();
    expect((await confirm(c, t.id, 1)).json()).toEqual({ error: 'trade_gone' });
    expect((await cancel(c, t.id)).json()).toEqual({ error: 'trade_gone' });
  });
});

describe('avisos al admin', () => {
  test('una IP compartida y una diferencia grande de rareza avisan', async () => {
    const ip = randomIp();
    const a = await player({ ip });
    const b = await player({ ip });
    const [ga, gb] = [await own(a.id, 'common'), await own(b.id, 'legendary')];
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    expect(((await confirm(b, t.id, 1)).json() as TradeView).status).toBe('done');
    const kinds = await ctx.db.selectFrom('galaxy.trade_alerts').select('kind').where('trade_id', '=', t.id).execute();
    expect(kinds.map((k) => k.kind).sort()).toEqual(['shared_ip', 'unbalanced']);
  });
});

test('sin sesión no hay trueques', async () => {
  expect((await get(ctx.app, '/galaxy/api/trades')).statusCode).toBe(401);
});
