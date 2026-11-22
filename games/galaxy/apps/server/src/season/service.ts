import { type ConfigValue, type Gift, type SeasonConfig, type SeasonReward, type SeasonView, seasonCurrency, seasonOpen, seasonTier } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { credit, debit } from '../economy/wallet';
import { HttpError } from '../errors';
import { grantGifts } from '../gifts/grant';
import { ranking } from '../social/leaderboard';
import { pendingResult } from './close';
import { grantCosmetics } from '../cosmetics/service';

// The season route and shop (GDD §11.1, §13.1; M7d-1). The score is the General leaderboard's (runs that count plus
// the points of missions, achievements and admins), read before any transaction: the ranking reads with its own
// connection. Each step pays once; the shop sells up to each item's limit; once a season has closed, what is left of
// its currency becomes dust. Since PR 4 of «temporadas como fichas» a step or an item also pays its gifts of any kind,
// under the same guard (the step's claim row, the item's counter), keyed by the operation and with galaxies seeded by
// the season, the step or purchase and the account: never by the client's key.

export type RouteConfig = ConfigValue<'seasonRoute'>;
export interface SeasonConfigs {
  season: SeasonConfig;
  route: RouteConfig;
  minRunSeconds: number;
}

export async function seasonConfigs(config: ConfigReader): Promise<SeasonConfigs> {
  const [season, route, account] = await Promise.all([config.get('season'), config.get('seasonRoute'), config.get('account')]);
  return { season, route, minRunSeconds: account.minRunSeconds };
}

/** The account's season score as the General leaderboard counts it (0 off the leaderboard or out of season). */
export async function seasonScore(db: Kysely<DB>, c: SeasonConfigs, accountId: string, now: Date): Promise<number> {
  if (!seasonOpen(c.season, now)) return 0;
  const rows = await ranking(db, c.season, 'general', c.minRunSeconds);
  return rows.find((r) => r.accountId === accountId)?.value ?? 0;
}

async function payReward(trx: Kysely<DB>, accountId: string, seasonId: string, reward: SeasonReward, reason: string, ref: unknown, key: string): Promise<void> {
  for (const cur of ['coins', 'dust', 'signal'] as const) {
    if (reward[cur] > 0) await credit(trx, accountId, cur, reward[cur], reason, ref, key);
  }
  if (reward.shards > 0) await credit(trx, accountId, seasonCurrency(seasonId), reward.shards, reason, ref, key);
  await grantCosmetics(trx, accountId, reward);
}

/**
 * What paying a step or an item did that its caller acts on once the transaction commits: whether its gifts touched the
 * season's score, so the cached ranking is dropped then (dropped inside it, a read in between would cache it again
 * without them). A record never gives season points (they would pay steps that pay points), but dropping is cheap.
 */
export interface SeasonPaid {
  seasonTouched: boolean;
}

/** A step's or an item's gifts, inside its guarded transaction (the season is open: its own currency is paid). */
async function payGifts(trx: Kysely<DB>, accountId: string, seasonId: string, gifts: readonly Gift[], ctx: { key: string; seedKey: string; reason: string; ref: unknown; auditAction: string }): Promise<SeasonPaid> {
  if (gifts.length === 0) return { seasonTouched: false };
  const { seasonTouched } = await grantGifts(trx, accountId, gifts, { ...ctx, key: `${ctx.key}:gifts`, actor: { id: accountId, label: 'temporada' }, season: { id: seasonId, open: true } });
  return { seasonTouched };
}

export async function seasonView(db: Kysely<DB>, c: SeasonConfigs, accountId: string, score: number, now: Date): Promise<SeasonView> {
  const name = c.route.currency.name;
  const closing = await pendingResult(db, accountId);
  if (!seasonOpen(c.season, now)) return { season: null, score: 0, tier: null, currency: { name, balance: 0 }, steps: [], shop: [], closing };
  const id = c.season.id;
  const [claims, bought, balance] = await Promise.all([
    db.selectFrom('galaxy.season_route_claims').select('step').where('account_id', '=', accountId).where('season', '=', id).execute(),
    db.selectFrom('galaxy.season_purchases').select(['item', 'bought']).where('account_id', '=', accountId).where('season', '=', id).execute(),
    db.selectFrom('galaxy.balances').select('amount').where('account_id', '=', accountId).where('currency', '=', seasonCurrency(id)).executeTakeFirst(),
  ]);
  const claimed = new Set(claims.map((x) => x.step));
  const count = new Map(bought.map((x) => [x.item, x.bought]));
  return {
    season: { id, name: c.season.name, startsAt: c.season.startsAt, endsAt: c.season.endsAt, tiers: c.season.tiers },
    score,
    tier: seasonTier(score, c.season),
    currency: { name, balance: Number(balance?.amount ?? 0) },
    steps: c.route.steps.map((s) => ({ at: s.at, reward: s.reward, gifts: s.gifts, reached: score >= s.at, claimed: claimed.has(s.at) })),
    shop: c.route.shop.map((i) => ({ id: i.id, name: i.name, price: i.price, limit: i.limit, bought: count.get(i.id) ?? 0, reward: i.reward, gifts: i.gifts })),
    closing,
  };
}

/** Collects a route step the score has reached, once (the caller drops the ranking after the commit when told to). */
export async function claimStep(trx: Kysely<DB>, c: SeasonConfigs, accountId: string, at: number, score: number, key: string, now: Date): Promise<SeasonPaid> {
  if (!seasonOpen(c.season, now)) throw new HttpError(409, 'season_closed');
  const step = c.route.steps.find((s) => s.at === at);
  if (!step) throw new HttpError(404, 'season_step_not_found');
  if (score < at) throw new HttpError(409, 'mission_not_ready');
  const won = await trx
    .insertInto('galaxy.season_route_claims')
    .values({ account_id: accountId, season: c.season.id, step: at })
    .onConflict((oc) => oc.doNothing())
    .returning('step')
    .executeTakeFirst();
  if (!won) throw new HttpError(409, 'already_claimed');
  const ref = { season: c.season.id, step: at };
  await payReward(trx, accountId, c.season.id, step.reward, 'season_route', ref, key);
  return payGifts(trx, accountId, c.season.id, step.gifts, { key, seedKey: `season:${c.season.id}:step:${at}:${accountId}`, reason: 'season_route', ref, auditAction: 'season.route' });
}

/** Buys one of a shop item with the season currency, up to its limit (the ranking, like claimStep). */
export async function buyItem(trx: Kysely<DB>, c: SeasonConfigs, accountId: string, itemId: string, key: string, now: Date): Promise<SeasonPaid> {
  if (!seasonOpen(c.season, now)) throw new HttpError(409, 'season_closed');
  const item = c.route.shop.find((i) => i.id === itemId);
  if (!item) throw new HttpError(404, 'season_item_not_found');
  const id = c.season.id;
  await trx.insertInto('galaxy.season_purchases').values({ account_id: accountId, season: id, item: item.id }).onConflict((oc) => oc.doNothing()).execute();
  const one = await trx
    .updateTable('galaxy.season_purchases')
    .set({ bought: sql`bought + 1`, updated_at: now })
    .where('account_id', '=', accountId)
    .where('season', '=', id)
    .where('item', '=', item.id)
    .where('bought', '<', item.limit)
    .returning('bought')
    .executeTakeFirst();
  if (!one) throw new HttpError(409, 'season_item_sold_out');
  const ref = { season: id, item: item.id };
  await debit(trx, accountId, seasonCurrency(id), item.price, 'season_shop', ref, key);
  await payReward(trx, accountId, id, item.reward, 'season_shop', ref, key);
  // The purchase's number (its counter after this one) tells each one's galaxies apart.
  return payGifts(trx, accountId, id, item.gifts, { key, seedKey: `season:${id}:shop:${item.id}:${one.bought}:${accountId}`, reason: 'season_shop', ref, auditAction: 'season.shop' });
}

/**
 * Once a season has closed, what is left of its currency becomes dust at the route's rate (GDD §11.1, unfavourable on
 * purpose). Every balance of a season that is not the open one is converted whole, under its row's lock.
 */
export async function convertLeftovers(db: Kysely<DB>, c: SeasonConfigs, accountId: string, now: Date): Promise<void> {
  const open = seasonOpen(c.season, now) ? seasonCurrency(c.season.id) : null;
  const left = await db
    .selectFrom('galaxy.balances')
    .select('currency')
    .where('account_id', '=', accountId)
    .where('currency', 'like', 'season:%')
    .where('amount', '>', '0')
    .execute();
  const old = left.map((r) => r.currency).filter((cur) => cur !== open);
  if (old.length === 0) return;
  await db.transaction().execute(async (trx) => {
    for (const cur of old) {
      const row = await trx.selectFrom('galaxy.balances').select('amount').where('account_id', '=', accountId).where('currency', '=', cur).forUpdate().executeTakeFirst();
      const n = Number(row?.amount ?? 0);
      if (n <= 0) continue;
      const season = cur.slice('season:'.length);
      await debit(trx, accountId, cur, n, 'season_convert', { season });
      const dust = n * c.route.currency.dustRate;
      if (dust > 0) await credit(trx, accountId, 'dust', dust, 'season_convert', { season, shards: n });
    }
  });
}
