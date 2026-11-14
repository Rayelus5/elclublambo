import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { generateGalaxy, type MyTrades, PROBE_TEST, parseConfig, TIERS, type Tier, type TradeView } from '@galaxy/shared';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { expireTrades } from '../../src/market/trades';
import { fixedConfig, get, openLive, post, put, randomIp, sessionCookie, settle, testApp, uniqueName } from '../helpers';

// Swaps on the server (GDD §14.5, §14.7; M5c-2; trades 2.0 on 2026-11-14): up to three galaxies a side and coins on one
// side. What a side offers stays in escrow (its coins held); every change is a new version, and the swap runs when both
// confirmed the same one. The trade gates, open and daily limits, expiry, the history and the alerts for the admin.
// Every account and galaxy here is new.

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

type Deal = { galaxies: string[]; coins: number };
const deal = (galaxies: string[] = [], coins = 0): Deal => ({ galaxies, coins });
const one = (g: string | null | undefined): Deal => deal(g ? [g] : []);
const proposeDeal = (p: P, username: string, give: Deal, want: Deal = deal()) => post(ctx.app, '/galaxy/api/trades', { username, give, want }, { cookie: p.cookie, headers: { 'idempotency-key': randomUUID() } });
const propose = (p: P, username: string, give: string, want?: string) => proposeDeal(p, username, one(give), one(want));
const offerDeal = (p: P, id: string, body: { give: Deal; want: Deal; version: number }) => post(ctx.app, `/galaxy/api/trades/${id}/offer`, body, { cookie: p.cookie });
const offer = (p: P, id: string, body: { give: string | null; want: string | null; version: number }) => offerDeal(p, id, { give: one(body.give), want: one(body.want), version: body.version });
const coinsOf = async (p: P) => (await getWallet(ctx.db, p.id)).coins;
const held = async (p: P) => Number((await ctx.db.selectFrom('galaxy.coin_holds').select(sql<string>`coalesce(sum(amount), 0)`.as('n')).where('account_id', '=', p.id).where('status', '=', 'held').executeTakeFirstOrThrow()).n);
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
    expect(t).toMatchObject({ version: 1, status: 'open', proposedByMe: true, me: { galaxies: [{ id: ga }], coins: 0, confirmed: true }, them: { username: b.username, galaxies: [{ id: gb }], confirmed: false } });
    const seen = (await mine(b)).open.find((x) => x.id === t.id)!;
    expect(seen).toMatchObject({ proposedByMe: false, me: { galaxies: [{ id: gb }], confirmed: false }, them: { username: a.username, galaxies: [{ id: ga }], confirmed: true } });
    expect(seen.history).toEqual([expect.objectContaining({ version: 1, kind: 'proposed', byMe: false, deal: { me: { galaxies: [expect.objectContaining({ id: gb })], coins: 0 }, them: { galaxies: [expect.objectContaining({ id: ga })], coins: 0 } } })]);
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
    expect((await propose(low, b.username, await own(low.id))).json()).toEqual({ error: 'trade_level', minLevel: 10 });
  });

  test('un trueque abierto por pareja, en cualquier sentido', async () => {
    const { a, b, ga, gb } = await pair();
    expect((await propose(a, b.username, ga)).statusCode).toBe(200);
    expect((await propose(a, b.username, await own(a.id))).json()).toEqual({ error: 'trade_exists' });
    expect((await propose(b, a.username, gb)).json()).toEqual({ error: 'trade_exists' });
  });

  test('las propuestas que recibes no te impiden proponer; las que puedes recibir tienen su límite', async () => {
    const victim = await player();
    const [x, y, z] = [await player(), await player(), await player()];
    expect((await propose(x, victim.username, await own(x.id))).statusCode).toBe(200);
    expect((await propose(y, victim.username, await own(y.id))).statusCode).toBe(200);
    expect((await propose(z, victim.username, await own(z.id))).json()).toEqual({ error: 'trade_limit_them' });
    expect((await propose(victim, z.username, await own(victim.id))).statusCode).toBe(200);
  });

  test('la misma galaxia en dos trueques a la vez: solo uno', async () => {
    const a = await player();
    const [b, c] = [await player(), await player()];
    const g = await own(a.id);
    const answers = await Promise.all([propose(a, b.username, g), propose(a, c.username, g)]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(answers.find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'galaxy_in_trade' });
  });

  test('proponer y poner en venta la misma galaxia a la vez: solo una de las dos', async () => {
    const { a, b } = await pair();
    const g = await own(a.id);
    const [t, l] = await Promise.all([
      propose(a, b.username, g),
      post(ctx.app, '/galaxy/api/market/listings', { galaxyId: g, price: 50 }, { cookie: a.cookie, headers: { 'idempotency-key': randomUUID() } }),
    ]);
    expect([t.statusCode, l.statusCode].sort()).toEqual([200, 409]);
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

  test('dos confirmaciones a la vez: un solo intercambio', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const answers = await Promise.all([confirm(b, t.id, 1), confirm(b, t.id, 1)]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await ownerOf(ga)).toBe(b.id);
    expect(await ownerOf(gb)).toBe(a.id);
  });

  test('guardar el trato tal cual lo acepta: con las dos partes conformes, se intercambian', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const same = (await offer(b, t.id, { give: gb, want: ga, version: 1 })).json() as TradeView;
    expect(same.status).toBe('done');
    expect(await ownerOf(ga)).toBe(b.id);
  });

  test('un cambio es otra versión: la confirmación vieja no vale y quien cambia confirma la nueva', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const other = await own(b.id, 'rare');
    const v2 = (await offer(b, t.id, { give: other, want: ga, version: 1 })).json() as TradeView;
    expect(v2).toMatchObject({ version: 2, me: { galaxies: [{ id: other }], confirmed: true }, them: { confirmed: false } });
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

// Trades 2.0 (the owner, 2026-11-14: «oro, hasta 3 galaxias por lado, contraofertas»).
describe('trueques 2.0', () => {
  test('tres galaxias por lado cruzan a la vez; una cuarta no cabe', async () => {
    const a = await player();
    const b = await player();
    const mineA = [await own(a.id), await own(a.id), await own(a.id)];
    const mineB = [await own(b.id), await own(b.id)];
    expect((await proposeDeal(a, b.username, deal([...mineA, await own(a.id)]), deal(mineB))).json()).toEqual({ error: 'trade_too_many' });
    const t = (await proposeDeal(a, b.username, deal(mineA), deal(mineB))).json() as TradeView;
    expect(t.me.galaxies.map((g) => g.id).sort()).toEqual([...mineA].sort());
    for (const g of mineA) expect((await equip(a, g)).json()).toEqual({ error: 'galaxy_in_trade' });
    expect(((await confirm(b, t.id, 1)).json() as TradeView).status).toBe('done');
    for (const g of mineA) expect(await ownerOf(g)).toBe(b.id);
    for (const g of mineB) expect(await ownerOf(g)).toBe(a.id);
  });

  test('el oro va en un solo lado; ni la misma galaxia dos veces, ni dar nada al proponer', async () => {
    const { a, b, ga, gb } = await pair();
    expect((await proposeDeal(a, b.username, deal([ga], 100), deal([gb], 100))).json()).toEqual({ error: 'trade_coins_both' });
    expect((await proposeDeal(a, b.username, deal([ga]), deal([ga]))).json()).toEqual({ error: 'trade_duplicate' });
    expect((await proposeDeal(a, b.username, deal(), deal([gb]))).json()).toEqual({ error: 'trade_empty' });
    expect((await proposeDeal(a, b.username, deal([], 500), deal([gb]))).json()).toEqual({ error: 'insufficient_funds' });
  });

  test('monedas por una galaxia: se reservan al ofrecerlas y, hecho el trato, el otro las cobra menos la comisión', async () => {
    const { a, b, ga, gb } = await pair();
    await credit(ctx.db, b.id, 'coins', 3000, 'test');
    // A gives a galaxy and asks for 1000 coins; B offers them by confirming.
    const t = (await proposeDeal(a, b.username, deal([ga]), deal([], 1000))).json() as TradeView;
    expect(t.them).toMatchObject({ galaxies: [], coins: 1000, confirmed: false });
    const done = (await confirm(b, t.id, 1)).json() as TradeView;
    expect(done).toMatchObject({ status: 'done', commission: 70 });
    expect(await ownerOf(ga)).toBe(b.id);
    expect(await coinsOf(b)).toBe(2000);
    expect(await held(b)).toBe(0);
    expect(await coinsOf(a)).toBe(930);
    const reasons = await ctx.db.selectFrom('galaxy.ledger').select('reason').where('account_id', 'in', [a.id, b.id]).where('reason', 'like', 'trade_%').execute();
    expect(reasons.map((r) => r.reason).sort()).toEqual(['trade_coins', 'trade_hold']);
    // The galaxy B's coins bought is B's, free to use.
    expect((await equip(b, ga)).statusCode).toBe(200);
    expect(await ownerOf(gb)).toBe(b.id);
  });

  test('las monedas ofrecidas vuelven al cancelar, al cambiarlas y al caducar', async () => {
    const { a, b, gb } = await pair();
    await credit(ctx.db, a.id, 'coins', 1000, 'test');
    const t = (await proposeDeal(a, b.username, deal([], 800), deal([gb]))).json() as TradeView;
    expect(await coinsOf(a)).toBe(200);
    expect(await held(a)).toBe(800);
    // A counter-offer of its own with other coins: the old hold back, the new one held.
    const v2 = (await offerDeal(a, t.id, { give: deal([], 600), want: deal([gb]), version: 1 })).json() as TradeView;
    expect(v2).toMatchObject({ version: 2, me: { coins: 600 } });
    expect(await coinsOf(a)).toBe(400);
    expect(await held(a)).toBe(600);
    expect((await cancel(a, t.id)).statusCode).toBe(200);
    expect(await coinsOf(a)).toBe(1000);
    expect(await held(a)).toBe(0);
    // Again, left to expire: the market job gives them back.
    const c = await player();
    const t2 = (await proposeDeal(a, c.username, deal([], 300), deal([await own(c.id)]))).json() as TradeView;
    expect(await coinsOf(a)).toBe(700);
    await ctx.db.updateTable('galaxy.trades').set({ created_at: new Date(Date.now() - 2000), expires_at: new Date(Date.now() - 1000) }).where('id', '=', t2.id).execute();
    expect(await expireTrades(ctx.db)).toBeGreaterThanOrEqual(1);
    expect(await coinsOf(a)).toBe(1000);
    expect((await mine(a)).closed.find((x) => x.id === t2.id)?.status).toBe('expired');
  });

  test('contraofertas: cada una queda en el historial, con su trato y quién la hizo', async () => {
    const { a, b, ga, gb } = await pair();
    const gb2 = await own(b.id);
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    expect((await offerDeal(b, t.id, { give: deal([gb2]), want: deal([ga]), version: 1 })).statusCode).toBe(200);
    expect((await confirm(a, t.id, 2)).statusCode).toBe(200);
    const view = (await mine(a)).closed.find((x) => x.id === t.id)!;
    expect(view.history.map((e) => [e.version, e.kind, e.byMe])).toEqual([
      [1, 'proposed', true],
      [2, 'countered', false],
      [2, 'done', true],
    ]);
    expect(view.history[1]!.deal).toEqual({ me: { galaxies: [expect.objectContaining({ id: ga })], coins: 0 }, them: { galaxies: [expect.objectContaining({ id: gb2 })], coins: 0 } });
    expect(await ownerOf(gb2)).toBe(a.id);
    expect(await ownerOf(gb)).toBe(b.id);
  });
});

test('sin sesión no hay trueques', async () => {
  expect((await get(ctx.app, '/galaxy/api/trades')).statusCode).toBe(401);
});

describe('avisos en tiempo real', () => {
  test('proponer avisa solo al otro, con quién propone, y repetir la operación no repite el aviso', async () => {
    const { a, b, ga, gb } = await pair();
    const [la, lb] = [await openLive(ctx.app, a.cookie), await openLive(ctx.app, b.cookie)];
    const key = randomUUID();
    const body = { username: b.username, give: one(ga), want: one(gb) };
    const first = await post(ctx.app, '/galaxy/api/trades', body, { cookie: a.cookie, headers: { 'idempotency-key': key } });
    expect(first.statusCode).toBe(200);
    await post(ctx.app, '/galaxy/api/trades', body, { cookie: a.cookie, headers: { 'idempotency-key': key } });
    await settle();
    const id = (first.json() as TradeView).id;
    expect(lb.notices()).toEqual([{ kind: 'trade', event: 'proposed', trade: id, from: { username: a.username, avatar: null, frame: null } }]);
    expect(la.notices()).toEqual([]);
    la.ws.terminate();
    lb.ws.terminate();
  });

  test('confirmar avisa al otro de que le toca, y cerrar el trueque le avisa de que está hecho', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const la = await openLive(ctx.app, a.cookie);
    // B confirms the version A proposed (and already confirmed): the swap happens and A hears it is done.
    expect((await confirm(b, t.id, t.version)).statusCode).toBe(200);
    await settle();
    expect(la.notices()).toEqual([{ kind: 'trade', event: 'done', trade: t.id, from: expect.objectContaining({ username: b.username }) }]);
    la.ws.terminate();
  });

  test('cambiar el trueque avisa de la contraoferta, y cancelarlo, de la cancelación', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga)).json() as TradeView;
    const la = await openLive(ctx.app, a.cookie);
    const changed = await offer(b, t.id, { give: gb, want: ga, version: t.version });
    expect(changed.statusCode).toBe(200);
    expect((await cancel(b, t.id)).statusCode).toBe(200);
    await settle();
    expect(la.notices().map((n) => (n.kind === 'trade' ? n.event : n.kind))).toEqual(['countered', 'cancelled']);
    la.ws.terminate();
  });

  test('un intercambio que falla no avisa de nada', async () => {
    const { a, b, ga, gb } = await pair();
    const t = (await propose(a, b.username, ga, gb)).json() as TradeView;
    const la = await openLive(ctx.app, a.cookie);
    // B equips the galaxy A asked for (only wanted, so it may): B's confirm fails and nothing reaches A.
    expect((await equip(b, gb)).statusCode).toBe(200);
    expect((await confirm(b, t.id, t.version)).statusCode).toBe(409);
    await settle();
    expect(la.notices()).toEqual([]);
    la.ws.terminate();
  });
});
