import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { type AdminAlertsPage, type AdminDealsPage, commissionOf, type DealLineage, generateGalaxy, PROBE_TEST, parseConfig, type Role, type TradeView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, debit, getWallet } from '../../src/economy/wallet';
import { createAdminViaCli, fixedConfig, get, post, put, randomIp, sessionCookie, testApp, totpNow, uniqueName } from '../helpers';

// Trade moderation on the server (GDD §16.1, §16.2, §16.4; M6c-2), for admins only: the history of listings and
// trades; cancelling an active listing or an open trade; reverting a sale or a done trade once, with the admin's
// password, only when every galaxy can go back (its lineage says where it went), releasing its holds and booking
// compensating entries (a seller short of coins goes to 0 and the shortfall is recorded); and reviewing alerts.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ market: { openTrades: 5, perDay: { listings: 20, purchases: 20, trades: 20 } } }) });
});
afterAll(() => ctx.close());

const DAY = 86_400_000;
const LEVEL_10 = parseConfig('account', {}).levels[8]!;
const PRICE = 600;
const COMMISSION = commissionOf(PRICE, parseConfig('market', {}).commission);

async function player(ip = randomIp()) {
  const username = uniqueName('amk');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' }, { ip });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie, ip });
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: LEVEL_10 }).execute();
  await ctx.db.updateTable('galaxy.accounts').set({ created_at: new Date(Date.now() - 4 * DAY) }).where('id', '=', id).execute();
  return { cookie, id, username, ip };
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

let seedCounter = 1n;
async function own(owner: string, tier = 0): Promise<string> {
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 991n + seedCounter++, tier);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier, score: g.score, finish: 'normal', origin: 'grant' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const key = () => ({ 'idempotency-key': randomUUID() });
async function list(seller: P, galaxyId: string, price = PRICE): Promise<string> {
  const res = await post(ctx.app, '/galaxy/api/market/listings', { galaxyId, price }, { cookie: seller.cookie, headers: key(), ip: seller.ip });
  expect(res.statusCode).toBe(200);
  return (res.json() as { id: string }).id;
}
async function buy(buyer: P, listing: string) {
  await credit(ctx.db, buyer.id, 'coins', PRICE, 'test');
  const res = await post(ctx.app, `/galaxy/api/market/listings/${listing}/buy`, undefined, { cookie: buyer.cookie, headers: key(), ip: buyer.ip });
  expect(res.statusCode).toBe(200);
}
async function sale(seller: P, buyer: P) {
  const galaxy = await own(seller.id);
  const listing = await list(seller, galaxy);
  await buy(buyer, listing);
  return { galaxy, listing };
}
async function trade(a: P, b: P) {
  const [ga, gb] = [await own(a.id), await own(b.id)];
  const t = (await post(ctx.app, '/galaxy/api/trades', { username: b.username, give: ga, want: gb }, { cookie: a.cookie, headers: key() })).json() as TradeView;
  expect((await post(ctx.app, `/galaxy/api/trades/${t.id}/confirm`, { version: t.version }, { cookie: b.cookie })).statusCode).toBe(200);
  return { id: t.id, ga, gb };
}

const A = (path: string) => `/galaxy/api/admin/market${path}`;
const act = (path: string, body: object, cookie = admin.cookie) => post(ctx.app, A(path), body, { cookie });
const read = async <T>(path: string) => (await get(ctx.app, A(path), { cookie: admin.cookie })).json() as T;
const ownerOf = async (g: string) => (await ctx.db.selectFrom('galaxy.galaxies').select('owner_id').where('id', '=', g).executeTakeFirstOrThrow()).owner_id;
const coins = async (p: P) => (await getWallet(ctx.db, p.id)).coins;
const audits = (id: string) => ctx.db.selectFrom('galaxy.admin_audit_log').select(['action', 'actor_label', 'before', 'after', 'reason']).where('target_id', '=', id).orderBy('id').execute();
const revert = (kind: 'listings' | 'trades', id: string, password = admin.password) => act(`/${kind}/${id}/revert`, { reason: 'Fraude entre cuentas', password });

describe('quién entra', () => {
  test('un jugador o un moderador no ven ni tocan el comercio', async () => {
    const p = await player();
    const mod = await staff('moderator');
    for (const cookie of [p.cookie, mod.cookie]) {
      expect((await get(ctx.app, A('/deals?kind=listings'), { cookie })).statusCode).toBe(403);
      expect((await get(ctx.app, A('/alerts'), { cookie })).statusCode).toBe(403);
      expect((await act(`/listings/${randomUUID()}/cancel`, { reason: 'Prueba' }, cookie)).statusCode).toBe(403);
    }
    expect((await get(ctx.app, A('/deals?kind=trades'))).statusCode).toBe(401);
  });
});

describe('historial', () => {
  test('los anuncios y los trueques de una cuenta, con su estado y lo más nuevo primero', async () => {
    const [s, b] = await Promise.all([player(), player()]);
    const sold = await sale(s, b);
    const open = await list(s, await own(s.id));
    const t = await trade(s, b);
    const listings = await read<AdminDealsPage>(`/deals?kind=listings&user=${s.username}`);
    expect(listings.kind).toBe('listings');
    expect(listings.rows.map((r) => [r.id, r.status])).toEqual([
      [open, 'active'],
      [sold.listing, 'sold'],
    ]);
    expect(listings.rows[1]).toMatchObject({ seller: s.username, buyer: b.username, price: PRICE, commission: COMMISSION, galaxy: { id: sold.galaxy }, reversal: null });
    expect((await read<AdminDealsPage>(`/deals?kind=listings&user=${b.username}&status=sold`)).rows.map((r) => r.id)).toEqual([sold.listing]);
    const trades = await read<AdminDealsPage>(`/deals?kind=trades&user=${b.username}`);
    expect(trades.rows[0]).toMatchObject({ id: t.id, a: s.username, b: b.username, status: 'done', aGalaxy: { id: t.ga }, bGalaxy: { id: t.gb }, reversal: null });
  });
});

describe('cancelar', () => {
  test('un anuncio activo se retira con motivo, una sola vez, y queda en la auditoría', async () => {
    const s = await player();
    const listing = await list(s, await own(s.id));
    expect((await act(`/listings/${listing}/cancel`, { reason: 'Precio abusivo' })).json()).toEqual({ cancelled: true });
    expect((await act(`/listings/${listing}/cancel`, { reason: 'Otra vez' })).json()).toEqual({ error: 'listing_gone' });
    expect(await audits(listing)).toMatchObject([{ action: 'market.cancel', actor_label: admin.username, before: { status: 'active', seller: s.username, price: PRICE }, reason: 'Precio abusivo' }]);
  });

  test('un trueque abierto se cancela, y uno cerrado responde que ya no está', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const t = (await post(ctx.app, '/galaxy/api/trades', { username: b.username, give: await own(a.id) }, { cookie: a.cookie, headers: key() })).json() as TradeView;
    expect((await act(`/trades/${t.id}/cancel`, { reason: 'Acoso con propuestas' })).json()).toEqual({ cancelled: true });
    expect((await act(`/trades/${t.id}/cancel`, { reason: 'Otra vez' })).json()).toEqual({ error: 'trade_gone' });
    const done = await trade(a, b);
    expect((await act(`/trades/${done.id}/cancel`, { reason: 'Cerrado' })).json()).toEqual({ error: 'trade_gone' });
    expect((await audits(t.id)).map((r) => r.action)).toEqual(['trade.cancel']);
  });
});

describe('revertir una venta', () => {
  test('con la contraseña, la galaxia vuelve, el comprador recupera el precio y el vendedor devuelve lo cobrado; una sola vez', async () => {
    const [s, b] = await Promise.all([player(), player()]);
    const { galaxy, listing } = await sale(s, b);
    const [sellerBefore, buyerBefore] = [await coins(s), await coins(b)];
    expect((await revert('listings', listing, 'no-es-esta')).json()).toEqual({ error: 'password_wrong' });
    expect(await ownerOf(galaxy)).toBe(b.id);
    expect((await revert('listings', listing)).json()).toEqual({ reverted: true, shortfall: 0 });
    expect(await ownerOf(galaxy)).toBe(s.id);
    expect(await coins(b)).toBe(buyerBefore + PRICE);
    expect(await coins(s)).toBe(sellerBefore - (PRICE - COMMISSION));
    expect((await revert('listings', listing)).json()).toEqual({ error: 'already_reverted' });
    const row = (await read<AdminDealsPage>(`/deals?kind=listings&user=${s.username}`)).rows.find((r) => r.id === listing)!;
    expect(row).toMatchObject({ status: 'sold', reversal: { by: admin.username, reason: 'Fraude entre cuentas', shortfall: 0 } });
    const reasons = await ctx.db.selectFrom('galaxy.ledger').select(['account_id', 'delta', 'reason']).where('reason', '=', 'market_revert').where('account_id', 'in', [s.id, b.id]).execute();
    expect(reasons.map((r) => [r.account_id, Number(r.delta)]).sort()).toEqual([
      [b.id, PRICE],
      [s.id, -(PRICE - COMMISSION)],
    ].sort());
    expect(await audits(listing)).toMatchObject([{ action: 'market.revert', after: { galaxy, to: s.username, refunded: PRICE, recovered: PRICE - COMMISSION, shortfall: 0 } }]);
  });

  test('un vendedor que ya gastó las monedas queda a 0 y la diferencia se apunta', async () => {
    const [s, b] = await Promise.all([player(), player()]);
    const { listing } = await sale(s, b);
    const left = 100;
    await debit(ctx.db, s.id, 'coins', (await coins(s)) - left, 'test');
    expect((await revert('listings', listing)).json()).toEqual({ reverted: true, shortfall: PRICE - COMMISSION - left });
    expect(await coins(s)).toBe(0);
  });

  test('si el comprador la revendió no se revierte, y el linaje dice a quién', async () => {
    const [s, b, c] = await Promise.all([player(), player(), player()]);
    const { galaxy, listing } = await sale(s, b);
    const resale = await list(b, galaxy);
    await buy(c, resale);
    const lineage = await read<DealLineage>(`/lineage?kind=listing&id=${listing}`);
    expect(lineage).toMatchObject({ returnable: false, reversal: null, galaxies: [{ galaxy: { id: galaxy }, from: s.username, to: b.username, owner: c.username, gone: false, returnable: false, laterMoves: [{ kind: 'sale', id: resale, from: b.username, to: c.username }] }] });
    const res = await revert('listings', listing);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'revert_blocked', lineage: { returnable: false } });
    expect(await ownerOf(galaxy)).toBe(c.id);
  });

  test('si se fusionó o se desintegró tampoco, y el linaje lo dice', async () => {
    const [s, b] = await Promise.all([player(), player()]);
    const { galaxy, listing } = await sale(s, b);
    await ctx.db.updateTable('galaxy.galaxies').set({ disintegrated_at: new Date() }).where('id', '=', galaxy).execute();
    const child = await own(b.id, 1);
    await ctx.db.updateTable('galaxy.galaxies').set({ origin: 'fusion', lineage: [galaxy] }).where('id', '=', child).execute();
    const lineage = await read<DealLineage>(`/lineage?kind=listing&id=${listing}`);
    expect(lineage.galaxies[0]).toMatchObject({ gone: true, owner: null, fusedInto: { galaxy: { id: child }, owner: b.username }, returnable: false });
    expect((await revert('listings', listing)).json()).toMatchObject({ error: 'revert_blocked' });
  });

  test('dos admins a la vez: una reversión y un 409', async () => {
    const [s, b] = await Promise.all([player(), player()]);
    const other = await staff('admin');
    const { listing } = await sale(s, b);
    const [x, y] = await Promise.all([revert('listings', listing), act(`/listings/${listing}/revert`, { reason: 'Fraude', password: other.password }, other.cookie)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await ctx.db.selectFrom('galaxy.deal_reversals').select('id').where('listing_id', '=', listing).execute()).toHaveLength(1);
  });
});

describe('revertir un trueque', () => {
  test('cada galaxia vuelve a su dueño, libre de lo que la retenía, y queda en la auditoría', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const t = await trade(a, b);
    expect((await put(ctx.app, '/galaxy/api/hangar/loadout', { relics: [t.ga, null] }, { cookie: b.cookie })).statusCode).toBe(200);
    expect((await revert('trades', t.id)).json()).toEqual({ reverted: true });
    expect([await ownerOf(t.ga), await ownerOf(t.gb)]).toEqual([a.id, b.id]);
    expect(await ctx.db.selectFrom('galaxy.loadouts').select('slot').where('galaxy_id', '=', t.ga).execute()).toHaveLength(0);
    expect(await audits(t.id)).toMatchObject([{ action: 'trade.revert', before: { held: { [t.ga]: ['equipped'], [t.gb]: [] } } }]);
    expect((await revert('trades', t.id)).json()).toEqual({ error: 'already_reverted' });
  });

  test('un trueque que no se cerró no se revierte', async () => {
    const [a, b] = await Promise.all([player(), player()]);
    const t = (await post(ctx.app, '/galaxy/api/trades', { username: b.username, give: await own(a.id) }, { cookie: a.cookie, headers: key() })).json() as TradeView;
    expect((await revert('trades', t.id)).json()).toEqual({ error: 'trade_gone' });
  });
});

describe('alertas', () => {
  test('una venta entre cuentas de la misma IP salta, se revisa con motivo una vez y deja de estar pendiente', async () => {
    const ip = randomIp();
    const [s, b] = await Promise.all([player(ip), player(ip)]);
    const { listing } = await sale(s, b);
    const pending = await read<AdminAlertsPage>('/alerts?reviewed=false');
    const alert = pending.rows.find((r) => r.deal?.id === listing)!;
    expect(alert).toMatchObject({ kind: 'shared_ip', deal: { kind: 'listing', id: listing }, seller: s.username, buyer: b.username, review: null });
    expect((await act(`/alerts/${alert.id}/review`, { reason: 'Hermanos que juegan juntos' })).json()).toEqual({ reviewed: true });
    expect((await act(`/alerts/${alert.id}/review`, { reason: 'Otra vez' })).json()).toEqual({ error: 'alert_reviewed' });
    expect((await read<AdminAlertsPage>('/alerts?reviewed=false')).rows.some((r) => r.id === alert.id)).toBe(false);
    expect((await read<AdminAlertsPage>('/alerts?reviewed=true')).rows.find((r) => r.id === alert.id)).toMatchObject({ review: { by: admin.username, reason: 'Hermanos que juegan juntos' } });
    expect(await audits(alert.id)).toMatchObject([{ action: 'alert.review', reason: 'Hermanos que juegan juntos' }]);
  });
});


