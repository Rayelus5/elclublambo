import { randomBytes, randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type GalaxyDetail, generateGalaxy, type MarketPage, type MyMarket, PROBE_TEST, parseConfig, TIERS, type Tier } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { fixedConfig, get, post, put, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

// The market on the server (GDD §14.6, §14.7; M5c-1): who may trade, listing a galaxy at least at its rarity's floor
// (it stays in escrow), browsing, buying it once (the commission sinks), withdrawing it, today's caps, and the alerts
// for the admin. Every account and galaxy here is new, with a random name.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ market: { perDay: { listings: 3, purchases: 10 } } }) });
});
afterAll(() => ctx.close());

const DAY = 86_400_000;
const LEVEL_10 = parseConfig('account', {}).levels[8]!;

async function player(opts: { level10?: boolean; days?: number; coins?: number; ip?: string } = {}) {
  const { level10 = true, days = 4, coins = 0, ip = randomIp() } = opts;
  const username = uniqueName('mkt');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' }, { ip });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  if (level10) await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: LEVEL_10 }).execute();
  await ctx.db.updateTable('galaxy.accounts').set({ created_at: new Date(Date.now() - days * DAY) }).where('id', '=', id).execute();
  if (coins > 0) await credit(ctx.db, id, 'coins', coins, 'test');
  return { cookie, id, username, ip };
}
type P = Awaited<ReturnType<typeof player>>;

let seedCounter = 1n;
async function own(owner: string, tier: Tier = 'common', name?: string): Promise<string> {
  const t = TIERS.indexOf(tier);
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 523n + seedCounter++, t);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: name ?? g.name, designation: g.designation, tier: t, score: g.score, finish: 'normal', origin: 'grant' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const key = () => ({ 'idempotency-key': randomUUID() });
const list = (p: P, galaxyId: string, price: number, headers = key()) => post(ctx.app, '/galaxy/api/market/listings', { galaxyId, price }, { cookie: p.cookie, headers });
const buy = (p: P, id: string, headers = key()) => post(ctx.app, `/galaxy/api/market/listings/${id}/buy`, undefined, { cookie: p.cookie, headers });
const cancel = (p: P, id: string) => post(ctx.app, `/galaxy/api/market/listings/${id}/cancel`, undefined, { cookie: p.cookie });
const browse = async (p: P, query = '') => (await get(ctx.app, `/galaxy/api/market${query}`, { cookie: p.cookie })).json() as MarketPage;
const mine = async (p: P) => (await get(ctx.app, '/galaxy/api/market/mine', { cookie: p.cookie })).json() as MyMarket;
const coins = async (p: P) => (await getWallet(ctx.db, p.id)).coins;
const ownerOf = async (galaxyId: string) => (await ctx.db.selectFrom('galaxy.galaxies').select('owner_id').where('id', '=', galaxyId).executeTakeFirstOrThrow()).owner_id;

async function listed(seller: P, tier: Tier = 'common', price = 50, name?: string): Promise<{ galaxyId: string; listingId: string }> {
  const galaxyId = await own(seller.id, tier, name);
  const res = await list(seller, galaxyId, price);
  expect(res.statusCode).toBe(200);
  return { galaxyId, listingId: (res.json() as { id: string }).id };
}

describe('quién comercia', () => {
  test('hace falta nivel 10 y 3 días de cuenta, y las reglas lo dicen', async () => {
    const low = await player({ level10: false });
    const young = await player({ days: 2 });
    const g1 = await own(low.id);
    const g2 = await own(young.id);
    // The refusal says the live requirement, so the message never states a number the admin has changed.
    expect((await list(low, g1, 50)).json()).toEqual({ error: 'trade_level', minLevel: 10 });
    expect((await list(young, g2, 50)).json()).toEqual({ error: 'trade_age', minAccountDays: 3 });
    expect((await browse(low)).rules).toMatchObject({ canTrade: false, reason: 'level', minLevel: 10, minAccountDays: 3, commission: 0.07 });
    expect((await browse(young)).rules).toMatchObject({ canTrade: false, reason: 'age' });
    const ok = await player();
    expect((await browse(ok)).rules).toMatchObject({ canTrade: true, reason: null, listingsLeft: 3, purchasesLeft: 10, minPrice: { common: 50, legendary: 6000 } });
  });
});

describe('poner en venta', () => {
  test('desde el mínimo de su rareza hasta el máximo, y la galaxia queda en depósito', async () => {
    const s = await player();
    const g = await own(s.id, 'rare');
    expect((await list(s, g, 399)).json()).toEqual({ error: 'price_too_low' });
    expect((await list(s, g, 10_000_001)).json()).toEqual({ error: 'price_too_high' });
    const res = await list(s, g, 400);
    expect(res.statusCode).toBe(200);
    expect((await list(s, g, 500)).json()).toEqual({ error: 'galaxy_listed' });

    // In escrow: no other door out.
    expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [g, null] }, { cookie: s.cookie })).json()).toEqual({ error: 'galaxy_listed' });
    expect((await put(ctx.app, '/galaxy/api/planetarium/exhibits', { galaxies: [g] }, { cookie: s.cookie })).json()).toEqual({ error: 'galaxy_listed' });
    expect((await post(ctx.app, `/galaxy/api/galaxies/${g}/disintegrate`, undefined, { cookie: s.cookie, headers: key() })).json()).toEqual({ error: 'galaxy_listed' });
    const others = [await own(s.id, 'rare'), await own(s.id, 'rare'), await own(s.id, 'rare'), await own(s.id, 'rare')];
    expect((await post(ctx.app, '/galaxy/api/galaxies/fuse', { ids: [g, ...others] }, { cookie: s.cookie, headers: key() })).json()).toEqual({ error: 'galaxy_listed' });
    await credit(ctx.db, s.id, 'dust', 100_000, 'test');
    expect((await post(ctx.app, `/galaxy/api/galaxies/${g}/level-up`, { level: 2 }, { cookie: s.cookie, headers: key() })).json()).toEqual({ error: 'galaxy_listed' });
    expect(((await get(ctx.app, `/galaxy/api/galaxies/${g}`, { cookie: s.cookie })).json() as GalaxyDetail).listed).toBe(true);
  });

  test('una galaxia equipada o expuesta no se vende, ni una ajena', async () => {
    const s = await player();
    const [eq, ex] = [await own(s.id), await own(s.id)];
    expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [eq, null] }, { cookie: s.cookie })).statusCode).toBe(200);
    expect((await put(ctx.app, '/galaxy/api/planetarium/exhibits', { galaxies: [ex] }, { cookie: s.cookie })).statusCode).toBe(200);
    expect((await list(s, eq, 50)).json()).toEqual({ error: 'galaxy_equipped' });
    expect((await list(s, ex, 50)).json()).toEqual({ error: 'galaxy_exhibited' });
    const other = await player();
    expect((await list(s, await own(other.id), 50)).json()).toEqual({ error: 'galaxy_not_found' });
  });

  test('el límite de anuncios del día', async () => {
    const s = await player();
    for (let i = 0; i < 3; i++) expect((await list(s, await own(s.id), 50)).statusCode).toBe(200);
    const fourth = await list(s, await own(s.id), 50);
    expect(fourth.statusCode).toBe(429);
    expect(fourth.json()).toEqual({ error: 'trade_daily_cap' });
    expect((await browse(s)).rules.listingsLeft).toBe(0);
  });

  test('el límite del día aguanta peticiones a la vez', async () => {
    const s = await player();
    const galaxies = await Promise.all([1, 2, 3, 4, 5].map(() => own(s.id)));
    const answers = await Promise.all(galaxies.map((g) => list(s, g, 50)));
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 429, 429]);
  });
});

describe('el escaparate', () => {
  test('filtra por rareza, ordena por precio, busca por nombre y oculta lo caducado', async () => {
    const s = await player();
    const word = `Zq${randomBytes(4).toString('hex')}`;
    const cheap = await listed(s, 'epic', 1500, `${word} Uno`);
    const dear = await listed(s, 'epic', 2500, `${word} Dos`);
    const viewer = await player();
    const found = await browse(viewer, `?tier=epic&sort=cheap&q=${word}`);
    expect(found.listings.map((l) => l.id)).toEqual([cheap.listingId, dear.listingId]);
    expect(found.listings[0]).toMatchObject({ seller: s.username, price: 1500, galaxy: { tier: 'epic' } });
    expect((await browse(viewer, `?tier=epic&sort=dear&q=${word}`)).listings.map((l) => l.id)).toEqual([dear.listingId, cheap.listingId]);

    await ctx.db.updateTable('galaxy.market_listings').set({ expires_at: new Date(Date.now() - 1000), listed_at: new Date(Date.now() - 2000) }).where('id', '=', dear.listingId).execute();
    expect((await browse(viewer, `?q=${word}`)).listings.map((l) => l.id)).toEqual([cheap.listingId]);
    // Expired: it can be equipped again, and bought no more.
    expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [dear.galaxyId, null] }, { cookie: s.cookie })).statusCode).toBe(200);
    const late = await player({ coins: 5000 });
    expect((await buy(late, dear.listingId)).json()).toEqual({ error: 'listing_gone' });
  });
});

describe('comprar', () => {
  test('el comprador paga el precio, el vendedor cobra menos la comisión y la galaxia cambia de dueño', async () => {
    const s = await player();
    const b = await player({ coins: 1000 });
    const { galaxyId, listingId } = await listed(s, 'uncommon', 600);
    const headers = key();
    const res = await buy(b, listingId, headers);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ galaxy: { id: galaxyId }, wallet: { coins: 400 } });
    expect(await coins(b)).toBe(400);
    expect(await coins(s)).toBe(600 - 42);
    expect(await ownerOf(galaxyId)).toBe(b.id);
    // A retry with the same key: the same answer, no second charge.
    expect((await buy(b, listingId, headers)).json()).toEqual(res.json());
    expect(await coins(b)).toBe(400);
    const reasons = await ctx.db.selectFrom('galaxy.ledger').select(['account_id', 'reason', 'delta']).where('ref', '@>', JSON.stringify({ listing: listingId }) as never).execute();
    expect(reasons.map((r) => [r.reason, Number(r.delta)]).sort()).toEqual([['market_buy', -600], ['market_sale', 558]]);

    const sold = (await mine(s)).sold.find((x) => x.id === listingId);
    expect(sold).toMatchObject({ buyer: b.username, price: 600, net: 558 });
    expect((await mine(s)).active.map((x) => x.id)).not.toContain(listingId);
  });

  test('dos compradores a la vez: uno se la lleva y el otro conserva sus monedas', async () => {
    const s = await player();
    const [b1, b2] = [await player({ coins: 100 }), await player({ coins: 100 })];
    const { galaxyId, listingId } = await listed(s);
    const answers = await Promise.all([buy(b1, listingId), buy(b2, listingId)]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(answers.find((r) => r.statusCode === 409)!.json()).toEqual({ error: 'listing_gone' });
    expect([await coins(b1), await coins(b2)].sort((x, y) => x - y)).toEqual([50, 100]);
    expect([b1.id, b2.id]).toContain(await ownerOf(galaxyId));
  });

  test('retirar mientras alguien compra: gana uno solo', async () => {
    const s = await player();
    const b = await player({ coins: 100 });
    const { galaxyId, listingId } = await listed(s);
    const [c, p] = await Promise.all([cancel(s, listingId), buy(b, listingId)]);
    expect([c.statusCode, p.statusCode].sort()).toEqual([200, 409]);
    if (p.statusCode === 200) expect(await ownerOf(galaxyId)).toBe(b.id);
    else {
      expect(await ownerOf(galaxyId)).toBe(s.id);
      expect(await coins(b)).toBe(100);
    }
  });

  test('una galaxia destacada sigue destacada en manos del comprador', async () => {
    const s = await player();
    const b = await player({ coins: 1000 });
    const { galaxyId, listingId } = await listed(s);
    await ctx.db.updateTable('galaxy.galaxies').set({ featured: true }).where('id', '=', galaxyId).execute();
    expect((await buy(b, listingId)).json()).toMatchObject({ galaxy: { id: galaxyId, featured: true } });
  });

  test('una galaxia que acabó equipada o expuesta no se vende', async () => {
    const s = await player();
    const b = await player({ coins: 1000 });
    const { galaxyId, listingId } = await listed(s);
    // As if the seller equipped it in the instant its listing expired, while this purchase waited for its locks.
    await ctx.db.insertInto('galaxy.loadouts').values({ account_id: s.id, slot: 0, galaxy_id: galaxyId }).execute();
    expect((await buy(b, listingId)).json()).toEqual({ error: 'listing_gone' });
    expect(await coins(b)).toBe(1000);
    expect(await ownerOf(galaxyId)).toBe(s.id);
  });

  test('una galaxia que acabó ofrecida en un trueque no se vende', async () => {
    const s = await player();
    const b = await player({ coins: 1000 });
    const other = await player();
    const { galaxyId, listingId } = await listed(s);
    // As if the seller offered it in a swap the instant its listing expired, while this purchase waited.
    await ctx.db.insertInto('galaxy.trades').values({ a_id: s.id, b_id: other.id, a_galaxy: galaxyId, a_offered: true, expires_at: new Date(Date.now() + DAY) }).execute();
    expect((await buy(b, listingId)).json()).toEqual({ error: 'listing_gone' });
    expect(await ownerOf(galaxyId)).toBe(s.id);
  });

  test('lo de un vendedor baneado ni se ve ni se compra', async () => {
    const s = await player();
    const b = await player({ coins: 1000 });
    const word = `Bn${randomBytes(4).toString('hex')}`;
    const { listingId } = await listed(s, 'common', 50, `${word} Uno`);
    await ctx.db.updateTable('galaxy.accounts').set({ banned_until: new Date(Date.now() + DAY) }).where('id', '=', s.id).execute();
    expect((await browse(b, `?q=${word}`)).listings).toEqual([]);
    expect((await buy(b, listingId)).json()).toEqual({ error: 'listing_gone' });
    expect(await coins(b)).toBe(1000);
  });

  test('ni lo propio, ni sin monedas, ni sin las reglas del comercio', async () => {
    const s = await player({ coins: 500 });
    const { listingId } = await listed(s, 'common', 300);
    expect((await buy(s, listingId)).json()).toEqual({ error: 'own_listing' });
    const poor = await player({ coins: 10 });
    const res = await buy(poor, listingId);
    expect(res.statusCode).toBe(402);
    expect((await browse(poor, '')).listings.map((l) => l.id)).toContain(listingId);
    expect((await buy(await player({ level10: false, coins: 1000 }), listingId)).json()).toEqual({ error: 'trade_level', minLevel: 10 });
  });

  test('retirar devuelve la galaxia, y solo lo retira su vendedor', async () => {
    const s = await player();
    const { galaxyId, listingId } = await listed(s);
    expect((await cancel(await player(), listingId)).json()).toEqual({ error: 'listing_gone' });
    expect((await cancel(s, listingId)).statusCode).toBe(200);
    expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [galaxyId, null] }, { cookie: s.cookie })).statusCode).toBe(200);
  });
});

describe('avisos al admin', () => {
  const alerts = (listingId: string) => ctx.db.selectFrom('galaxy.trade_alerts').select(['kind']).where('listing_id', '=', listingId).execute();

  test('una IP compartida y un precio desorbitado avisan, y la venta sigue', async () => {
    const ip = randomIp();
    const s = await player({ ip });
    const b = await player({ ip, coins: 2000 });
    const { listingId } = await listed(s, 'common', 1000);
    expect((await buy(b, listingId)).statusCode).toBe(200);
    expect((await alerts(listingId)).map((a) => a.kind).sort()).toEqual(['shared_ip', 'unbalanced']);

    // Logging out (its session row goes) does not hide the IP it came from.
    const ip2 = randomIp();
    const s3 = await player({ ip: ip2 });
    const shared = await listed(s3, 'common', 60);
    expect((await post(ctx.app, '/galaxy/api/auth/logout', undefined, { cookie: s3.cookie })).statusCode).toBeLessThan(300);
    const b3 = await player({ ip: ip2, coins: 100 });
    expect((await buy(b3, shared.listingId)).statusCode).toBe(200);
    expect((await alerts(shared.listingId)).map((a) => a.kind)).toEqual(['shared_ip']);

    const s2 = await player();
    const b2 = await player({ coins: 100 });
    const fair = await listed(s2, 'common', 60);
    expect((await buy(b2, fair.listingId)).statusCode).toBe(200);
    expect(await alerts(fair.listingId)).toEqual([]);
  });
});

test('sin sesión no se ve el mercado', async () => {
  expect((await get(ctx.app, '/galaxy/api/market')).statusCode).toBe(401);
});
