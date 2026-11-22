import {
  EMPTY_SEASON_REWARD,
  type Gift,
  type HallOfFame,
  type SeasonHistory,
  seasonPlaceOf,
  type SeasonPrize,
  seasonPrizePlaces,
  type SeasonResult,
  type SeasonStats,
  seasonTier,
  type SeasonTier,
  SEASON_TIERS,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { credit } from '../economy/wallet';
import { HttpError } from '../errors';
import { grantGifts } from '../gifts/grant';
import { ranking } from '../social/leaderboard';
import type { SeasonConfigs } from './service';
import { grantCosmetics } from '../cosmetics/service';

// Closing a season (GDD §13.1; M7d-2). Once its end has passed, the first read that notices (or the minute job, plan
// «temporadas como fichas») archives it: the final General ranking becomes one result per player (place, score, tier
// and the rewards of that close, kept so a later change of the config cannot change them), the season's numbers are
// frozen with it, and each ranked player gets a message saying where they finished. Each result is collected once;
// the podium's are the station's trophies. An account that cannot win prizes for its place (admins who play) keeps its
// rank, and the podium goes to the next ones who can. Since PR 4 each prize keeps its gifts too, and a range of places
// pays its own (`closing.places`, by the place among those who can win prizes): all of it is collected at once.

/** Seasons already archived in this process: no query once known. */
const archived = new Set<string>();

/**
 * What a place pays: its tier's reward, plus the podium's when it is on it, plus its range's when its prize place
 * (among those who can win prizes for their place) falls in one. Each prize with its gifts.
 */
export function rewardsFor(podium: boolean, tier: SeasonTier | null, closing: SeasonConfigs['route']['closing'], place: number | null = null): SeasonPrize[] {
  const out: SeasonPrize[] = [];
  if (tier) {
    const i = SEASON_TIERS.indexOf(tier);
    out.push({ ...closing.tiers[i]!, gifts: [...(closing.tierGifts[i] ?? [])] });
  }
  if (podium) out.push({ ...closing.podium, gifts: [...closing.podiumGifts] });
  const range = place !== null ? seasonPlaceOf(closing.places, place) : null;
  if (range) out.push({ ...EMPTY_SEASON_REWARD, gifts: [...range.gifts], place: { from: range.from, to: range.to } });
  return out;
}

/**
 * Who is on the podium: the first `size` places among those who can win prizes for their place (an account that
 * cannot keeps its rank and is skipped). `rows` in rank order.
 */
export function podiumOf(rows: readonly { accountId: string; rank: number }[], size: number, ineligible: ReadonlySet<string>): Set<string> {
  return new Set(seasonPrizePlaces(rows, ineligible, size).keys());
}

async function seasonStats(db: Kysely<DB>, s: SeasonConfigs['season'], minRunSeconds: number, tiers: (SeasonTier | null)[]): Promise<SeasonStats> {
  const window = sql`r.finished_at >= ${new Date(s.startsAt)} and r.finished_at < ${new Date(s.endsAt)} and not r.suspicious and r.seconds >= ${minRunSeconds}::int`;
  const { rows: [agg] } = await sql<{ runs: string; kills: string; cores: string; extractions: string; depth: number | null }>`
    select count(*) as runs, coalesce(sum(r.kills), 0) as kills, coalesce(sum(r.boss_kills), 0) as cores,
      count(*) filter (where r.outcome = 'extracted') as extractions, max(r.depth) as depth
    from galaxy.runs r where ${window}`.execute(db);
  const most = async (column: 'sector' | 'probe') =>
    (await sql<{ v: string }>`select r.${sql.ref(column)} as v from galaxy.runs r where ${window} group by r.${sql.ref(column)} order by count(*) desc, r.${sql.ref(column)} limit 1`.execute(db)).rows[0]?.v ?? null;
  const count = Object.fromEntries(SEASON_TIERS.map((t) => [t, 0])) as Record<SeasonTier, number>;
  for (const t of tiers) if (t) count[t]++;
  return {
    players: tiers.length,
    runs: Number(agg?.runs ?? 0),
    kills: Number(agg?.kills ?? 0),
    cores: Number(agg?.cores ?? 0),
    extractions: Number(agg?.extractions ?? 0),
    maxDepth: agg?.depth ?? 0,
    topSector: await most('sector'),
    topProbe: await most('probe'),
    tiers: count,
  };
}

const TIER_NAME: Record<SeasonTier, string> = { bronze: 'Bronce', silver: 'Plata', gold: 'Oro', platinum: 'Platino', stellar: 'Estelar' };
const num = new Intl.NumberFormat('es-ES');

/** The message each ranked player gets when a season closes (a `season` message: its button opens Temporada). */
export function closingMail(name: string, rank: number, score: number, tier: SeasonTier | null, prizes: boolean): { title: string; body: string } {
  const where = tier ? `Quedaste ${num.format(rank)}.º en el tramo ${TIER_NAME[tier]}, con ${num.format(score)} puntos` : `Quedaste ${num.format(rank)}.º con ${num.format(score)} puntos`;
  return { title: `${name} ha terminado`.slice(0, 80), body: prizes ? `${where}. Tus premios te esperan en Temporada` : where };
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
  const ineligible = new Set((await db.selectFrom('galaxy.accounts').select('id').where('prize_eligible', '=', false).execute()).map((a) => a.id));
  const { podiumSize, places: ranges } = c.route.closing;
  const places = seasonPrizePlaces(rows, ineligible, Math.max(podiumSize, ...ranges.map((p) => p.to)));
  const results = rows.map((r) => {
    const tier = seasonTier(r.value, s);
    const place = places.get(r.accountId) ?? null;
    const onPodium = place !== null && place <= podiumSize;
    return { row: r, tier, podium: onPodium, rewards: rewardsFor(onPodium, tier, c.route.closing, place) };
  });
  const stats = await seasonStats(db, s, c.minRunSeconds, results.map((x) => x.tier));
  await db.transaction().execute(async (trx) => {
    const won = await trx
      .insertInto('galaxy.season_archive')
      .values({ season: s.id, name: s.name, starts_at: s.startsAt, ends_at: s.endsAt, players: rows.length, stats: JSON.stringify(stats) })
      .onConflict((oc) => oc.doNothing())
      .returning('season')
      .executeTakeFirst();
    if (!won) return;
    for (let i = 0; i < results.length; i += 500) {
      const chunk = results.slice(i, i + 500);
      await trx
        .insertInto('galaxy.season_results')
        .values(chunk.map((x) => ({ season: s.id, account_id: x.row.accountId, rank: x.row.rank, score: x.row.value, tier: x.tier, podium: x.podium, rewards: JSON.stringify(x.rewards) })))
        .execute();
      // Where each finished, in the same transaction as the archive row that won: a close that runs again sends nothing.
      const mails = chunk.map((x) => ({ x, mail: closingMail(s.name, x.row.rank, x.row.value, x.tier, x.rewards.length > 0) }));
      const made = await trx
        .insertInto('galaxy.mailbox_messages')
        .values(
          mails.map(({ x, mail }) => ({
            title: mail.title,
            body: mail.body,
            gifts: '{}',
            type: 'season' as const,
            audience: JSON.stringify({ kind: 'segment', usernames: [x.row.username.toLowerCase()] }),
            created_by: null,
            created_at: sql<Date>`now()`,
            expires_at: sql<Date>`now() + interval '60 days'`,
          })),
        )
        .returning('id')
        .execute();
      await trx.insertInto('galaxy.mailbox_receipts').values(made.map((m, k) => ({ message_id: m.id, account_id: mails[k]!.x.row.accountId }))).execute();
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
  rewards: r.rewards as SeasonPrize[],
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

/**
 * Collects a closed season's rewards, once (the guard is `claimed_at`): each old reward as before, and every prize's
 * gifts in one grant keyed by the claim, its galaxies seeded by the season and the account (never by the client's key).
 */
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
  const gifts: Gift[] = [];
  for (const reward of row.rewards as SeasonPrize[]) {
    for (const cur of ['coins', 'dust', 'signal'] as const) {
      if (reward[cur] > 0) await credit(trx, accountId, cur, reward[cur], 'season_close', { season }, key);
    }
    await grantCosmetics(trx, accountId, reward);
    gifts.push(...(reward.gifts ?? []));
  }
  if (gifts.length > 0) {
    await grantGifts(trx, accountId, gifts, {
      key: `${key}:gifts`,
      seedKey: `season:${season}:close:${accountId}`,
      reason: 'season_close',
      ref: { season },
      actor: { id: accountId, label: 'temporada' },
      // Closed: nothing seasonal is paid (a record never holds it either).
      season: { id: season, open: false },
      auditAction: 'season.close',
    });
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
