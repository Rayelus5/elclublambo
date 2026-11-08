import { type HallOfFame, type SeasonHistory, type SeasonResult, type SeasonReward, seasonTier, type SeasonTier, SEASON_TIERS } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { credit } from '../economy/wallet';
import { HttpError } from '../errors';
import { ranking } from '../social/leaderboard';
import type { SeasonConfigs } from './service';

// Closing a season (GDD §13.1; M7d-2). Once its end has passed, the first read that notices archives it: the final
// General ranking becomes one result per player (place, score, tier and the rewards of that close, kept so a later
// change of the config cannot change them). Each result is collected once; the podium's are the station's trophies.

/** Seasons already archived in this process: no query once known. */
const archived = new Set<string>();

/** What a place pays: its tier's reward, plus the podium's for the first places. */
export function rewardsFor(rank: number, tier: SeasonTier | null, closing: SeasonConfigs['route']['closing']): SeasonReward[] {
  const out: SeasonReward[] = [];
  if (tier) out.push(closing.tiers[SEASON_TIERS.indexOf(tier)]!);
  if (rank <= closing.podiumSize) out.push(closing.podium);
  return out;
}

/**
 * Archives the configured season if it has ended and nobody has yet (safe to call from any read). `force` archives it
 * even before its end: an admin replaced it with another season (M7d-3), so it will never be read again.
 */
export async function closeDue(db: Kysely<DB>, c: SeasonConfigs, now: Date, opts: { force?: boolean } = {}): Promise<void> {
  const s = c.season;
  if ((!opts.force && now.getTime() < Date.parse(s.endsAt)) || archived.has(s.id)) return;
  if (await db.selectFrom('galaxy.season_archive').select('season').where('season', '=', s.id).executeTakeFirst()) {
    archived.add(s.id);
    return;
  }
  // Read with the pool before the transaction (the ranking keeps its own connection); after the end nothing adds.
  const rows = await ranking(db, s, 'general', c.minRunSeconds);
  await db.transaction().execute(async (trx) => {
    const won = await trx
      .insertInto('galaxy.season_archive')
      .values({ season: s.id, name: s.name, starts_at: s.startsAt, ends_at: s.endsAt, players: rows.length })
      .onConflict((oc) => oc.doNothing())
      .returning('season')
      .executeTakeFirst();
    if (!won) return;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => {
        const tier = seasonTier(r.value, s);
        return { season: s.id, account_id: r.accountId, rank: r.rank, score: r.value, tier, podium: r.rank <= c.route.closing.podiumSize, rewards: JSON.stringify(rewardsFor(r.rank, tier, c.route.closing)) };
      });
      if (chunk.length > 0) await trx.insertInto('galaxy.season_results').values(chunk).execute();
    }
  });
  archived.add(s.id);
}

/** Forgets what this process knows is archived (tests that close a season more than once). */
export function forgetArchived(): void {
  archived.clear();
}

type ResultRow = { season: string; name: string; ends_at: Date; rank: number; score: number; tier: string | null; podium: boolean; rewards: unknown; claimed_at: Date | null };
const toResult = (r: ResultRow): SeasonResult => ({
  season: r.season,
  name: r.name,
  endsAt: r.ends_at.toISOString(),
  rank: r.rank,
  score: r.score,
  tier: r.tier as SeasonTier | null,
  podium: r.podium,
  rewards: r.rewards as SeasonReward[],
  claimed: r.claimed_at !== null,
});

/** The newest closed season whose rewards the account has still to collect (null when none). */
export async function pendingResult(db: Kysely<DB>, accountId: string): Promise<SeasonResult | null> {
  const r = await db
    .selectFrom('galaxy.season_results as r')
    .innerJoin('galaxy.season_archive as a', 'a.season', 'r.season')
    .select(['r.season', 'a.name', 'a.ends_at', 'r.rank', 'r.score', 'r.tier', 'r.podium', 'r.rewards', 'r.claimed_at'])
    .where('r.account_id', '=', accountId)
    .where('r.claimed_at', 'is', null)
    .where(sql<boolean>`jsonb_array_length(r.rewards) > 0`)
    .orderBy('a.ends_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return r ? toResult(r) : null;
}

/** Collects a closed season's rewards, once. */
export async function claimResult(trx: Kysely<DB>, accountId: string, season: string, key: string, now: Date): Promise<void> {
  const row = await trx
    .updateTable('galaxy.season_results')
    .set({ claimed_at: now })
    .where('account_id', '=', accountId)
    .where('season', '=', season)
    .where('claimed_at', 'is', null)
    .returning('rewards')
    .executeTakeFirst();
  if (!row) {
    const any = await trx.selectFrom('galaxy.season_results').select('season').where('account_id', '=', accountId).where('season', '=', season).executeTakeFirst();
    throw any ? new HttpError(409, 'already_claimed') : new HttpError(404, 'season_result_not_found');
  }
  for (const reward of row.rewards as SeasonReward[]) {
    for (const cur of ['coins', 'dust', 'signal'] as const) {
      if (reward[cur] > 0) await credit(trx, accountId, cur, reward[cur], 'season_close', { season }, key);
    }
    for (const [kind, value] of [['title', reward.title], ['frame', reward.frame]] as const) {
      if (value) await trx.insertInto('galaxy.cosmetics').values({ account_id: accountId, kind, value }).onConflict((oc) => oc.doNothing()).execute();
    }
  }
}

/** Every closed season, newest first, with its podium (banned players are left out of it). */
export async function hallOfFame(db: Kysely<DB>): Promise<HallOfFame> {
  const seasons = await db.selectFrom('galaxy.season_archive').select(['season', 'name', 'ends_at', 'players']).orderBy('ends_at', 'desc').limit(50).execute();
  if (seasons.length === 0) return { seasons: [] };
  const podium = await db
    .selectFrom('galaxy.season_results as r')
    .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
    .select(['r.season', 'a.username', 'r.rank', 'r.score'])
    .where('r.podium', '=', true)
    .where(
      'r.season',
      'in',
      seasons.map((s) => s.season),
    )
    .where((eb) => eb.or([eb('a.banned_until', 'is', null), eb('a.banned_until', '<=', sql<Date>`now()`)]))
    .orderBy('r.rank')
    .orderBy('a.username')
    .execute();
  return {
    seasons: seasons.map((s) => ({
      season: s.season,
      name: s.name,
      endsAt: s.ends_at.toISOString(),
      players: s.players,
      podium: podium.filter((p) => p.season === s.season).map((p) => ({ username: p.username, rank: p.rank, score: p.score })),
    })),
  };
}

/** A player's closed seasons, newest first. */
export async function seasonHistory(db: Kysely<DB>, accountId: string): Promise<SeasonHistory> {
  const rows = await db
    .selectFrom('galaxy.season_results as r')
    .innerJoin('galaxy.season_archive as a', 'a.season', 'r.season')
    .select(['r.season', 'a.name', 'a.ends_at', 'r.rank', 'r.score', 'r.tier', 'r.podium', 'r.rewards', 'r.claimed_at'])
    .where('r.account_id', '=', accountId)
    .orderBy('a.ends_at', 'desc')
    .limit(50)
    .execute();
  return { seasons: rows.map((row) => { const r = toResult(row); return { season: r.season, name: r.name, endsAt: r.endsAt, rank: r.rank, score: r.score, tier: r.tier, podium: r.podium }; }) };
}
