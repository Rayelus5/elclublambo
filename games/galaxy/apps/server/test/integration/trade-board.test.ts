import { randomUUID } from 'node:crypto';
import { ENGINE_VERSION } from '@galaxy/engine';
import { generateGalaxy, type MyTradePosts, PROBE_TEST, parseConfig, TIERS, type Tier, type TradeBoardPage, type TradePostView, type TradeView } from '@galaxy/shared';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { credit, getWallet } from '../../src/economy/wallet';
import { expirePosts } from '../../src/market/board';
import { fixedConfig, get, post, randomIp, sessionCookie, testApp, uniqueName } from '../helpers';

// The public trade board on the server (the owner, 2026-11-14: «un tablón público» of trades): posting what one gives
// and is after, the board (newest first, by the rarity given, a page at a time, nobody blocked either way), answering a
// post with a trade that asks what it gives, the author accepting one (the post closes and the other answers are
// cancelled, their holds back), withdrawing a post, the limits, and blocked pairs not trading. Every account is new.

type Ctx = Awaited<ReturnType<typeof testApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await testApp({ config: fixedConfig({ market: { board: { open: 2, perDay: 3, days: 7, answers: 2 } } }) });
});
afterAll(() => ctx.close());

const DAY = 86_400_000;
const LEVEL_10 = parseConfig('account', {}).levels[8]!;

async function player() {
  const username = uniqueName('tbd');
  const res = await post(ctx.app, '/galaxy/api/auth/register', { username, password: 'una-clave-larga' }, { ip: randomIp() });
  const cookie = sessionCookie(res);
  const id = (res.json() as { id: string }).id;
  await post(ctx.app, '/galaxy/api/probe-test', { answers: PROBE_TEST.questions.map((q) => q.answers.indexOf('lumen' as never)) }, { cookie });
  await ctx.db.insertInto('galaxy.account_xp').values({ account_id: id, xp: LEVEL_10 }).execute();
  await ctx.db.updateTable('galaxy.accounts').set({ created_at: new Date(Date.now() - 4 * DAY) }).where('id', '=', id).execute();
  return { cookie, id, username };
}
type P = Awaited<ReturnType<typeof player>>;

let seedCounter = 1n;
async function own(owner: string, tier: Tier = 'common'): Promise<string> {
  const t = TIERS.indexOf(tier);
  const g = generateGalaxy(BigInt(Date.now()) * 1000n + 733n + seedCounter++, t);
  const row = await ctx.db
    .insertInto('galaxy.galaxies')
    .values({ owner_id: owner, seed: g.seed.toString(), engine_version: ENGINE_VERSION, traits: JSON.stringify(g.traits), dna: g.dna, name: g.name, designation: g.designation, tier: t, score: g.score, finish: 'normal', origin: 'grant' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const deal = (galaxies: string[] = [], coins = 0) => ({ galaxies, coins });
const key = () => ({ 'idempotency-key': randomUUID() });
const publish = (p: P, give: { galaxies: string[]; coins: number }, wants: object = { tiers: [], coins: false }, note = '') =>
  post(ctx.app, '/galaxy/api/trades/posts', { give, wants, note }, { cookie: p.cookie, headers: key() });
const boardOf = async (p: P, qs = '') => (await get(ctx.app, `/galaxy/api/trades/board${qs}`, { cookie: p.cookie })).json() as TradeBoardPage;
const minePosts = async (p: P) => (await get(ctx.app, '/galaxy/api/trades/posts/mine', { cookie: p.cookie })).json() as MyTradePosts;
const answer = (p: P, author: string, postId: string, give: { galaxies: string[]; coins: number }, want: { galaxies: string[]; coins: number }) =>
  post(ctx.app, '/galaxy/api/trades', { username: author, give, want, post: postId }, { cookie: p.cookie, headers: key() });
const confirm = (p: P, id: string, version: number) => post(ctx.app, `/galaxy/api/trades/${id}/confirm`, { version }, { cookie: p.cookie });
const tradeStatus = async (id: string) => (await ctx.db.selectFrom('galaxy.trades').select('status').where('id', '=', id).executeTakeFirstOrThrow()).status;
const ownerOf = async (g: string) => (await ctx.db.selectFrom('galaxy.galaxies').select('owner_id').where('id', '=', g).executeTakeFirstOrThrow()).owner_id;

describe('publicar', () => {
  test('una publicación sale en el tablón con lo que da y lo que busca; quien está bloqueado no la ve', async () => {
    const a = await player();
    const ga = await own(a.id, 'epic');
    const res = await publish(a, deal([ga]), { tiers: ['legendary'], palette: 'ember', coins: true }, 'Busco algo rojo');
    expect(res.statusCode).toBe(200);
    const p = res.json() as TradePostView;
    expect(p).toMatchObject({ author: a.username, mine: true, galaxies: [{ id: ga }], coins: 0, wants: { tiers: ['legendary'], palette: 'ember', coins: true }, note: 'Busco algo rojo', answers: 0 });
    const b = await player();
    const seen = (await boardOf(b)).posts.find((x) => x.id === p.id);
    expect(seen).toMatchObject({ mine: false, author: a.username, galaxies: [{ id: ga }] });
    expect((await boardOf(b, '?tier=epic')).posts.some((x) => x.id === p.id)).toBe(true);
    expect((await boardOf(b, '?tier=common')).posts.some((x) => x.id === p.id)).toBe(false);
    const c = await player();
    await ctx.db.insertInto('galaxy.blocks').values({ blocker: c.id, blocked: a.id }).execute();
    expect((await boardOf(c)).posts.some((x) => x.id === p.id)).toBe(false);
    expect((await minePosts(a)).posts.map((x) => x.id)).toContain(p.id);
  });

  test('solo lo mío y vivo, algo que dar, y con límite de abiertas', async () => {
    const a = await player();
    const other = await player();
    expect((await publish(a, deal([await own(other.id)]))).json()).toEqual({ error: 'galaxy_not_found' });
    expect((await publish(a, deal())).json()).toEqual({ error: 'trade_empty' });
    expect((await publish(a, deal([], 500))).json()).toEqual({ error: 'insufficient_funds' });
    expect((await publish(a, deal([await own(a.id)]))).statusCode).toBe(200);
    expect((await publish(a, deal([await own(a.id)]))).statusCode).toBe(200);
    expect((await publish(a, deal([await own(a.id)]))).json()).toEqual({ error: 'post_limit' });
  });

  test('el tablón va de página en página sin repetir', async () => {
    const authors = [await player(), await player(), await player()];
    const ids: string[] = [];
    for (const x of authors) ids.push(((await publish(x, deal([await own(x.id)]))).json() as TradePostView).id);
    const viewer = await player();
    const seen = new Set<string>();
    let next: string | null = '';
    for (let i = 0; i < 200 && next !== null; i++) {
      const page: TradeBoardPage = await boardOf(viewer, next ? `?cursor=${encodeURIComponent(next)}` : '');
      for (const x of page.posts) {
        expect(seen.has(x.id)).toBe(false);
        seen.add(x.id);
      }
      next = page.next;
    }
    for (const id of ids) expect(seen.has(id)).toBe(true);
  });
});

describe('responder', () => {
  test('una respuesta pide lo que da la publicación, y cuenta en ella', async () => {
    const a = await player();
    const ga = await own(a.id, 'rare');
    const p = (await publish(a, deal([ga]))).json() as TradePostView;
    const b = await player();
    const gb = await own(b.id);
    expect((await answer(b, a.username, p.id, deal([gb]), deal([await own(a.id)]))).json()).toEqual({ error: 'post_mismatch' });
    expect((await answer(b, a.username, p.id, deal([gb]), deal([ga], 100))).json()).toEqual({ error: 'post_mismatch' });
    const res = await answer(b, a.username, p.id, deal([gb]), deal([ga]));
    expect(res.statusCode).toBe(200);
    const t = res.json() as TradeView;
    expect(t).toMatchObject({ post: p.id, me: { galaxies: [{ id: gb }], confirmed: true }, them: { username: a.username, galaxies: [{ id: ga }], confirmed: false } });
    expect((await boardOf(b)).posts.find((x) => x.id === p.id)).toMatchObject({ answers: 1, myAnswer: t.id });
  });

  test('aceptar una respuesta cierra la publicación y cancela las demás, con sus monedas de vuelta', async () => {
    const a = await player();
    const ga = await own(a.id, 'epic');
    const p = (await publish(a, deal([ga]), { tiers: [], coins: true })).json() as TradePostView;
    const [b, c] = [await player(), await player()];
    await credit(ctx.db, b.id, 'coins', 2000, 'test');
    await credit(ctx.db, c.id, 'coins', 2000, 'test');
    const tb = (await answer(b, a.username, p.id, deal([], 1500), deal([ga]))).json() as TradeView;
    const tc = (await answer(c, a.username, p.id, deal([], 1200), deal([ga]))).json() as TradeView;
    expect((await getWallet(ctx.db, c.id)).coins).toBe(800);
    // A full post takes no more answers.
    const d = await player();
    expect((await answer(d, a.username, p.id, deal([await own(d.id)]), deal([ga]))).json()).toEqual({ error: 'post_full' });
    expect(((await confirm(a, tb.id, tb.version)).json() as TradeView).status).toBe('done');
    expect(await ownerOf(ga)).toBe(b.id);
    expect(await tradeStatus(tc.id)).toBe('cancelled');
    expect((await getWallet(ctx.db, c.id)).coins).toBe(2000);
    expect((await minePosts(a)).posts.find((x) => x.id === p.id)?.status).toBe('closed');
    expect((await boardOf(c)).posts.some((x) => x.id === p.id)).toBe(false);
  });

  test('retirar la publicación cancela sus respuestas; una caducada ya no se responde', async () => {
    const a = await player();
    const ga = await own(a.id);
    const p = (await publish(a, deal([ga]))).json() as TradePostView;
    const b = await player();
    const tb = (await answer(b, a.username, p.id, deal([await own(b.id)]), deal([ga]))).json() as TradeView;
    expect((await post(ctx.app, `/galaxy/api/trades/posts/${p.id}/cancel`, undefined, { cookie: b.cookie })).json()).toEqual({ error: 'post_gone' });
    expect((await post(ctx.app, `/galaxy/api/trades/posts/${p.id}/cancel`, undefined, { cookie: a.cookie })).json()).toEqual({ cancelled: true });
    expect(await tradeStatus(tb.id)).toBe('cancelled');
    const q = (await publish(a, deal([ga]))).json() as TradePostView;
    await ctx.db.updateTable('galaxy.trade_posts').set({ created_at: new Date(Date.now() - 2000), expires_at: new Date(Date.now() - 1000) }).where('id', '=', q.id).execute();
    expect(await expirePosts(ctx.db)).toBeGreaterThanOrEqual(1);
    const c = await player();
    expect((await answer(c, a.username, q.id, deal([await own(c.id)]), deal([ga]))).json()).toEqual({ error: 'post_gone' });
  });
});

test('las parejas bloqueadas no comercian, en ningún sentido', async () => {
  const a = await player();
  const b = await player();
  await ctx.db.insertInto('galaxy.blocks').values({ blocker: a.id, blocked: b.id }).execute();
  const propose = (from: P, to: P, g: string) => post(ctx.app, '/galaxy/api/trades', { username: to.username, give: deal([g]), want: deal() }, { cookie: from.cookie, headers: key() });
  expect((await propose(a, b, await own(a.id))).json()).toEqual({ error: 'trade_blocked' });
  expect((await propose(b, a, await own(b.id))).json()).toEqual({ error: 'trade_blocked' });
});
