import {
  dealProblem,
  givesSomething,
  type MyTradePosts,
  NO_DEAL,
  type PublicGalaxy,
  TIERS,
  type TradeBoardPage,
  type TradeBoardQuery,
  type TradeBoardRules,
  type TradeDealInput,
  type TradePostInput,
  type TradePostView,
} from '@galaxy/shared';
import { type Kysely, type Selectable, sql } from 'kysely';
import type { DB, TradePostsTable } from '../db/schema';
import { getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { type Notices, noticePlayer, withNotices } from '../realtime/notices';
import { decodeCursor, encodeCursor } from './cursor';
import { lockTrader, type MarketConfigs, type MarketDeps, marketConfigs, refuse, rulesFor, todayStart } from './service';

// The public trade board (the owner, 2026-11-14: «un tablón público» of trades): posts of what a player gives and what
// they are after, the newest first, a page at a time with a cursor; anyone answers one with a trade that names it
// (market/trades.ts). Nothing of a post is held: its galaxies stay the author's to use, and the board shows only the
// ones still theirs. Accepting an answer closes the post and cancels the other answers; cancelling the post cancels
// them too. Blocked pairs never see each other's posts.

type Post = Selectable<TradePostsTable>;
const PAGE = 24;
const DAY_MS = 86_400_000;

/** Either one blocked the other. */
export async function blockedBetween(db: Kysely<DB>, a: string, b: string): Promise<boolean> {
  const row = await db
    .selectFrom('galaxy.blocks')
    .select('blocker')
    .where((eb) => eb.or([eb.and([eb('blocker', '=', a), eb('blocked', '=', b)]), eb.and([eb('blocker', '=', b), eb('blocked', '=', a)])]))
    .executeTakeFirst();
  return row !== undefined;
}

async function boardRules(db: Kysely<DB>, viewer: string, cfgs: MarketConfigs, now: Date): Promise<TradeBoardRules> {
  const cfg = cfgs.market.board;
  const [rules, open, today] = await Promise.all([
    rulesFor(db, viewer, cfgs, now),
    db.selectFrom('galaxy.trade_posts').select(sql<number>`count(*)::int`.as('n')).where('author_id', '=', viewer).where('status', '=', 'open').where('expires_at', '>', now).executeTakeFirstOrThrow(),
    db.selectFrom('galaxy.trade_posts').select(sql<number>`count(*)::int`.as('n')).where('author_id', '=', viewer).where('created_at', '>=', todayStart(now)).executeTakeFirstOrThrow(),
  ]);
  return { canPost: rules.canTrade, openLeft: Math.max(0, cfg.open - open.n), todayLeft: Math.max(0, cfg.perDay - today.n), days: cfg.days, answers: cfg.answers };
}

/** The posts as the viewer sees them: their galaxies still the author's and alive, their open answers and mine. */
async function viewsOf(db: Kysely<DB>, viewer: string, posts: Post[], now: Date): Promise<TradePostView[]> {
  if (posts.length === 0) return [];
  const ids = posts.map((p) => p.id);
  const [items, answers, mine, authors] = await Promise.all([
    db
      .selectFrom('galaxy.trade_post_items as i')
      .innerJoin('galaxy.trade_posts as p', 'p.id', 'i.post_id')
      .innerJoin('galaxy.galaxies as g', 'g.id', 'i.galaxy_id')
      .select(['i.post_id', 'g.id', 'g.seed', 'g.tier', 'g.finish', 'g.traits', 'g.name', 'g.designation', 'g.featured', 'g.level'])
      .where('i.post_id', 'in', ids)
      .whereRef('g.owner_id', '=', 'p.author_id')
      .where('g.disintegrated_at', 'is', null)
      .orderBy('g.tier', 'desc')
      .orderBy('g.name')
      .execute(),
    db.selectFrom('galaxy.trades').select(['post_id', sql<number>`count(*)::int`.as('n')]).where('post_id', 'in', ids).where('status', '=', 'open').where('expires_at', '>', now).groupBy('post_id').execute(),
    db.selectFrom('galaxy.trades').select(['id', 'post_id']).where('post_id', 'in', ids).where('status', '=', 'open').where('expires_at', '>', now).where('a_id', '=', viewer).execute(),
    db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', [...new Set(posts.map((p) => p.author_id))]).execute(),
  ]);
  const nameOf = new Map(authors.map((a) => [a.id, a.username]));
  return posts.map((p) => ({
    id: p.id,
    author: nameOf.get(p.author_id) ?? '',
    mine: p.author_id === viewer,
    galaxies: items
      .filter((i) => i.post_id === p.id)
      .map(
        (g): PublicGalaxy => ({ id: g.id, seed: String(g.seed), tier: TIERS[g.tier]!, finish: g.finish as PublicGalaxy['finish'], traits: g.traits, name: g.name, designation: g.designation, featured: g.featured, level: g.level }),
      ),
    coins: Number(p.coins),
    wants: { tiers: (p.wants.tiers ?? []) as TradePostView['wants']['tiers'], coins: !!p.wants.coins, ...(p.wants.type ? { type: p.wants.type } : {}), ...(p.wants.palette ? { palette: p.wants.palette } : {}), ...(p.wants.phenomenon ? { phenomenon: p.wants.phenomenon } : {}) },
    note: p.note,
    status: p.status === 'open' && new Date(p.expires_at) <= now ? 'expired' : p.status,
    createdAt: new Date(p.created_at).toISOString(),
    expiresAt: new Date(p.expires_at).toISOString(),
    answers: answers.find((a) => a.post_id === p.id)?.n ?? 0,
    myAnswer: mine.find((m) => m.post_id === p.id)?.id ?? null,
  }));
}

/** A page of the board: open posts not past their date, from nobody blocked either way, the newest first. */
export async function tradeBoard(deps: MarketDeps, viewer: string, q: TradeBoardQuery): Promise<TradeBoardPage> {
  const now = deps.now();
  const cfgs = await marketConfigs(deps);
  let query = deps.db
    .selectFrom('galaxy.trade_posts as p')
    .selectAll('p')
    .where('p.status', '=', 'open')
    .where('p.expires_at', '>', now)
    .where(sql<boolean>`not exists (select 1 from galaxy.blocks k where (k.blocker = ${viewer} and k.blocked = p.author_id) or (k.blocked = ${viewer} and k.blocker = p.author_id))`);
  if (q.tier) {
    const tier = TIERS.indexOf(q.tier);
    query = query.where(sql<boolean>`exists (select 1 from galaxy.trade_post_items i join galaxy.galaxies g on g.id = i.galaxy_id where i.post_id = p.id and g.owner_id = p.author_id and g.disintegrated_at is null and g.tier = ${tier})`);
  }
  if (q.cursor) {
    const [at, id] = decodeCursor('board', q.cursor, 2);
    if (typeof at !== 'string' || typeof id !== 'string' || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'invalid_input');
    query = query.where(sql<boolean>`(p.created_at, p.id) < (${new Date(at)}::timestamptz, ${id}::uuid)`);
  }
  const rows = await query.orderBy('p.created_at', 'desc').orderBy('p.id', 'desc').limit(PAGE + 1).execute();
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  const next = rows.length > PAGE && last ? encodeCursor('board', [new Date(last.created_at).toISOString(), last.id]) : null;
  // A post whose galaxies all left its author (and gives no coins) has nothing to give any more: not shown.
  const posts = (await viewsOf(deps.db, viewer, page, now)).filter((p) => givesSomething(p));
  return { posts, next, rules: await boardRules(deps.db, viewer, cfgs, now) };
}

/** My posts: the open ones first, then the latest 20 closed. */
export async function myPosts(deps: MarketDeps, viewer: string): Promise<MyTradePosts> {
  const now = deps.now();
  const cfgs = await marketConfigs(deps);
  const rows = await deps.db.selectFrom('galaxy.trade_posts').selectAll().where('author_id', '=', viewer).orderBy('created_at', 'desc').limit(40).execute();
  const views = await viewsOf(deps.db, viewer, rows, now);
  return { posts: [...views.filter((v) => v.status === 'open'), ...views.filter((v) => v.status !== 'open').slice(0, 20)], rules: await boardRules(deps.db, viewer, cfgs, now) };
}

/** Posts on the board (inside its operation): the gates, the limits, what it gives (the author's galaxies and coins). */
export async function createPost(cfgs: MarketConfigs, trx: Kysely<DB>, authorId: string, req: TradePostInput, now: Date): Promise<TradePostView> {
  const problem = dealProblem(req.give, NO_DEAL, { tradeGalaxies: cfgs.market.tradeGalaxies, maxPrice: cfgs.market.maxPrice });
  if (problem) throw new HttpError(400, problem);
  if (!givesSomething(req.give)) throw new HttpError(400, 'trade_empty');
  await lockTrader(trx, authorId);
  refuse(await rulesFor(trx, authorId, cfgs, now));
  const rules = await boardRules(trx, authorId, cfgs, now);
  if (rules.openLeft === 0 || rules.todayLeft === 0) throw new HttpError(429, 'post_limit');
  if (req.give.galaxies.length) {
    const owned = await trx.selectFrom('galaxy.galaxies').select('id').where('id', 'in', req.give.galaxies).where('owner_id', '=', authorId).where('disintegrated_at', 'is', null).execute();
    if (owned.length !== req.give.galaxies.length) throw new HttpError(404, 'galaxy_not_found');
  }
  if (req.give.coins > 0 && (await getWallet(trx, authorId)).coins < req.give.coins) throw new HttpError(402, 'insufficient_funds');
  const post = await trx
    .insertInto('galaxy.trade_posts')
    .values({ author_id: authorId, coins: req.give.coins, wants: JSON.stringify(req.wants), note: req.note, created_at: now, expires_at: new Date(now.getTime() + cfgs.market.board.days * DAY_MS) })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (req.give.galaxies.length) await trx.insertInto('galaxy.trade_post_items').values(req.give.galaxies.map((g) => ({ post_id: post.id, galaxy_id: g }))).execute();
  return (await viewsOf(trx, authorId, [post], now))[0]!;
}

/** Cancels the open answers to a post but `keep` (their holds back, by the trades' trigger); their authors hear it. */
async function cancelAnswers(trx: Kysely<DB>, postId: string, keep: string | null, by: string, now: Date, out?: Notices): Promise<void> {
  let q = trx.updateTable('galaxy.trades').set({ status: 'cancelled', closed_at: now }).where('post_id', '=', postId).where('status', '=', 'open');
  if (keep) q = q.where('id', '!=', keep);
  const gone = await q.returning(['id', 'a_id']).execute();
  if (gone.length === 0) return;
  const from = await noticePlayer(trx, by);
  for (const g of gone) out?.add(g.a_id, { kind: 'trade', event: 'cancelled', trade: g.id, from });
}

/** The author withdraws a post: it closes, and its open answers are cancelled. */
export async function cancelPost(deps: MarketDeps, authorId: string, id: string): Promise<{ cancelled: true }> {
  const now = deps.now();
  return withNotices(deps.live, (out) =>
    deps.db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('galaxy.trade_posts').select(['author_id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || p.author_id !== authorId || p.status !== 'open') throw new HttpError(409, 'post_gone');
      await trx.updateTable('galaxy.trade_posts').set({ status: 'cancelled', closed_at: now }).where('id', '=', id).execute();
      await cancelAnswers(trx, id, null, authorId, now, out);
      return { cancelled: true as const };
    }),
  );
}

/** A trade that answered a post was done: the post closes and its other answers are cancelled. */
export async function closePost(trx: Kysely<DB>, postId: string, tradeId: string, by: string, now: Date, out?: Notices): Promise<void> {
  await trx.updateTable('galaxy.trade_posts').set({ status: 'closed', closed_at: now }).where('id', '=', postId).where('status', '=', 'open').execute();
  await cancelAnswers(trx, postId, tradeId, by, now, out);
}

/**
 * Checks an answer to a post (inside the proposal, the post row locked): open and not past its date, the target its
 * author, what the answer asks only what the post gives (some of its galaxies, its coins exactly) and something, and
 * room for one more answer.
 */
export async function checkAnswer(trx: Kysely<DB>, cfgs: MarketConfigs, postId: string, authorId: string, want: TradeDealInput, now: Date): Promise<void> {
  const p = await trx.selectFrom('galaxy.trade_posts').select(['author_id', 'status', 'expires_at', 'coins']).where('id', '=', postId).forUpdate().executeTakeFirst();
  if (!p || p.author_id !== authorId || p.status !== 'open' || new Date(p.expires_at) <= now) throw new HttpError(409, 'post_gone');
  const items = (await trx.selectFrom('galaxy.trade_post_items').select('galaxy_id').where('post_id', '=', postId).execute()).map((i) => i.galaxy_id);
  if (want.coins !== Number(p.coins) || !want.galaxies.every((g) => items.includes(g)) || !givesSomething(want)) throw new HttpError(400, 'post_mismatch');
  const { n } = await trx
    .selectFrom('galaxy.trades')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('post_id', '=', postId)
    .where('status', '=', 'open')
    .where('expires_at', '>', now)
    .executeTakeFirstOrThrow();
  if (n >= cfgs.market.board.answers) throw new HttpError(409, 'post_full');
}

/** Ends the posts past their date (the market job; a batch at a time, skipping locked rows). Their answers go on. */
export async function expirePosts(db: Kysely<DB>, batch = 500): Promise<number> {
  const res = await db
    .updateTable('galaxy.trade_posts')
    .set({ status: 'expired', closed_at: sql<Date>`now()` })
    .where('id', 'in', (eb) => eb.selectFrom('galaxy.trade_posts').select('id').where('status', '=', 'open').where('expires_at', '<=', sql<Date>`now()`).orderBy('expires_at').limit(batch).forUpdate().skipLocked())
    .executeTakeFirst();
  return Number(res.numUpdatedRows);
}
