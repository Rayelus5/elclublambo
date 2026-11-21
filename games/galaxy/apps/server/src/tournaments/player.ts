import {
  awardPlaces,
  datesOverlap,
  mediaUrl,
  runContribution,
  type TournamentCard,
  type TournamentClaimResult,
  type TournamentDetail,
  type TournamentEntryResult,
  type TournamentFee,
  type TournamentJoinBlock,
  type TournamentList,
  type TournamentMe,
  type TournamentRankRow,
  type TournamentRewards,
  type TournamentRunRow,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { runOperation } from '../economy/operations';
import { debit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { requestHash } from '../gacha/routes';
import { grantGifts } from '../gifts/grant';
import { accountLevel } from '../social/progress';
import type { TournamentDeps } from './admin';
import { entryLock, scoringOf, scoringSeason, tournamentById, tournamentBySlug, tournamentsIn, type TournamentRow } from './records';
import { cachedTournamentRanking, computeTournamentRanking, countedRunsSql, invalidateTournament, type TournamentRanking } from './scoring';

// Tournaments for players (plan «temporadas como fichas», part 5; GDD §13.3): the list in three tabs, a tournament's
// page (its ranking with the podium and the player's own row, their runs that count, the review and the results),
// signing up (the level, the cap, one exclusive tournament at a time, the fee), leaving (the score goes, and there is no
// way back) and collecting the prizes once the results are out. Each write is idempotent by its key and serialised per
// account, so two sign-ups at once can never both get into two exclusive tournaments.

const TOP = 50;
const FINISHED_SHOWN = 20;
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

type EntryRow = {
  tournament_id: string;
  joined_at: Date;
  left_at: Date | null;
  refunded_at: Date | null;
  disqualified: boolean;
  disqualified_reason: string | null;
  final_rank: number | null;
  final_score: string | null;
  final_runs: number | null;
  rewards: unknown;
  eligible: boolean | null;
  claimed_at: Date | null;
};
const ENTRY_FIELDS = ['tournament_id', 'joined_at', 'left_at', 'refunded_at', 'disqualified', 'disqualified_reason', 'final_rank', 'final_score', 'final_runs', 'rewards', 'eligible', 'claimed_at'] as const;

/** The ranking as it stands (30 s cache), with the season's rules and the account's minimum run. */
export async function liveRanking(deps: TournamentDeps, t: TournamentRow): Promise<TournamentRanking> {
  return cachedTournamentRanking(t.id, async () => {
    const [season, account] = await Promise.all([scoringSeason(deps.db, t), deps.config.get('account')]);
    return computeTournamentRanking(deps.db, scoringOf(t), season, account.minRunSeconds);
  });
}

/** When the results of a tournament in review come at the earliest. */
export const publishAt = (t: TournamentRow) => new Date(Date.parse(t.record.endsAt) + t.record.reviewHours * 3_600_000).toISOString();

function meOf(t: TournamentRow, e: EntryRow | undefined, ranking: TournamentRanking | null, accountId: string, eligible: boolean): TournamentMe | null {
  if (!e) return null;
  const status = e.disqualified ? 'disqualified' : e.left_at ? 'left' : 'joined';
  const base = { status, joinedAt: iso(e.joined_at)!, refunded: e.refunded_at !== null, reason: e.disqualified ? e.disqualified_reason : null, claimed: e.claimed_at !== null } as const;
  if (t.state === 'finished') {
    return { ...base, rank: e.final_rank, score: Number(e.final_score ?? 0), runs: e.final_runs ?? 0, eligible: e.eligible ?? eligible, rewards: (e.rewards as TournamentRewards | null) ?? null };
  }
  const r = status === 'joined' ? ranking?.entrants.get(accountId) : undefined;
  return { ...base, rank: r?.rank ?? null, score: r?.value ?? 0, runs: r?.runs ?? 0, eligible: r?.eligible ?? eligible, rewards: null };
}

/** What the viewer needs to know about themselves for the cards: their entries, level and exclusive tournaments. */
async function viewerOf(deps: TournamentDeps, accountId: string, ids: string[]) {
  const [entries, level, account, exclusive] = await Promise.all([
    ids.length > 0 ? deps.db.selectFrom('galaxy.tournament_entries').select(ENTRY_FIELDS).where('account_id', '=', accountId).where('tournament_id', 'in', ids).execute() : Promise.resolve([]),
    deps.config.get('account').then((cfg) => accountLevel(deps.db, accountId, cfg)),
    deps.db.selectFrom('galaxy.accounts').select('prize_eligible').where('id', '=', accountId).executeTakeFirst(),
    liveExclusives(deps.db, accountId, deps.now()),
  ]);
  return { entries: new Map(entries.map((e) => [e.tournament_id, e as EntryRow])), level, eligible: account?.prize_eligible ?? true, exclusive };
}

/** The exclusive tournaments the account is in now (not left nor disqualified, scheduled or running, not over). */
async function liveExclusives(db: Kysely<DB>, accountId: string, now: Date): Promise<{ id: string; slug: string; title: string; startsAt: string; endsAt: string }[]> {
  const rows = await db
    .selectFrom('galaxy.tournament_entries as e')
    .innerJoin('galaxy.tournaments as t', 't.id', 'e.tournament_id')
    .select(['t.id', 't.slug', 't.title', 't.starts_at', 't.ends_at'])
    .where('e.account_id', '=', accountId)
    .where('e.left_at', 'is', null)
    .where('e.disqualified', '=', false)
    .where('t.exclusive', '=', true)
    .where('t.state', 'in', ['scheduled', 'running'])
    .where('t.ends_at', '>', now)
    .execute();
  return rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, startsAt: r.starts_at.toISOString(), endsAt: r.ends_at.toISOString() }));
}

/** Live entrants per tournament (left and disqualified ones do not count). */
async function entrantCounts(db: Kysely<DB>, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .selectFrom('galaxy.tournament_entries')
    .select(['tournament_id', sql<number>`count(*)::int`.as('n')])
    .where('tournament_id', 'in', ids)
    .where('left_at', 'is', null)
    .where('disqualified', '=', false)
    .groupBy('tournament_id')
    .execute();
  return new Map(rows.map((r) => [r.tournament_id, r.n]));
}

/** Whether a viewer can sign up, and why not. */
export function joinBlock(
  t: TournamentRow,
  v: { entry: EntryRow | undefined; level: number; entrants: number; clash: { slug: string; title: string } | null },
  now: Date,
): TournamentJoinBlock | null {
  if (v.entry) return v.entry.disqualified ? 'disqualified' : v.entry.left_at ? 'left' : 'joined';
  if ((t.state !== 'scheduled' && t.state !== 'running') || Date.parse(t.record.endsAt) <= now.getTime()) return 'closed';
  if (t.record.maxEntrants !== null && v.entrants >= t.record.maxEntrants) return 'full';
  if (t.record.filters.minLevel !== null && v.level < t.record.filters.minLevel) return 'level';
  if (v.clash) return 'exclusive';
  return null;
}

function cardOf(t: TournamentRow, ctx: { entry: EntryRow | undefined; level: number; eligible: boolean; entrants: number; exclusive: { id: string; slug: string; title: string; startsAt: string; endsAt: string }[]; ranking: TournamentRanking | null; now: Date; accountId: string }): TournamentCard {
  const r = t.record;
  const clash = r.exclusive ? (ctx.exclusive.find((x) => x.id !== t.id && datesOverlap(x, r)) ?? null) : null;
  const block = joinBlock(t, { entry: ctx.entry, level: ctx.level, entrants: ctx.entrants, clash }, ctx.now);
  return {
    id: t.id,
    slug: r.slug,
    title: r.title,
    summary: r.summary,
    seasonId: r.seasonId,
    state: t.state as TournamentCard['state'],
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    resultsAt: t.state === 'review' ? publishAt(t) : t.state === 'finished' ? t.publishedAt : null,
    banner: r.bannerMedia ? mediaUrl(r.bannerMedia) : null,
    exclusive: r.exclusive,
    metric: r.metric,
    filters: r.filters,
    entry: r.entry,
    prizes: r.prizes,
    participation: r.participation,
    entrants: ctx.entrants,
    maxEntrants: r.maxEntrants,
    me: meOf(t, ctx.entry, ctx.ranking, ctx.accountId, ctx.eligible),
    join: { open: block === null, block },
    exclusiveWith: clash ? { slug: clash.slug, title: clash.title } : null,
  };
}

/** GET /galaxy/api/tournaments: running, upcoming and the last finished, reviewed or cancelled ones. */
export async function tournamentList(deps: TournamentDeps, accountId: string): Promise<TournamentList> {
  const now = deps.now();
  const all = await tournamentsIn(deps.db, ['scheduled', 'running', 'review', 'finished', 'cancelled']);
  const done = all.filter((t) => t.state === 'review' || t.state === 'finished' || t.state === 'cancelled').sort((a, b) => Date.parse(b.record.endsAt) - Date.parse(a.record.endsAt)).slice(0, FINISHED_SHOWN);
  const shown = [...all.filter((t) => t.state === 'scheduled' || t.state === 'running'), ...done];
  const ids = shown.map((t) => t.id);
  const [viewer, counts] = await Promise.all([viewerOf(deps, accountId, ids), entrantCounts(deps.db, ids)]);
  const cards = await Promise.all(
    shown.map(async (t) => {
      const entry = viewer.entries.get(t.id);
      // The live rank only where the viewer is in it and it still moves.
      const live = entry && !entry.left_at && !entry.disqualified && (t.state === 'running' || t.state === 'review');
      const ranking = live ? await liveRanking(deps, t) : null;
      return cardOf(t, { entry, level: viewer.level, eligible: viewer.eligible, entrants: counts.get(t.id) ?? 0, exclusive: viewer.exclusive, ranking, now, accountId });
    }),
  );
  return {
    running: cards.filter((c) => c.state === 'running'),
    upcoming: cards.filter((c) => c.state === 'scheduled'),
    finished: cards.filter((c) => c.state === 'review' || c.state === 'finished' || c.state === 'cancelled'),
    now: now.toISOString(),
  };
}

/** The final ranking of a finished tournament, as frozen (left, disqualified and unscored entrants have no place). */
async function frozenRanking(db: Kysely<DB>, id: string) {
  return db
    .selectFrom('galaxy.tournament_entries as e')
    .innerJoin('galaxy.accounts as a', 'a.id', 'e.account_id')
    .select(['e.account_id', 'a.username', 'a.avatar', 'a.frame', 'e.final_rank', 'e.final_score', 'e.eligible', 'e.rewards'])
    .where('e.tournament_id', '=', id)
    .where('e.final_rank', 'is not', null)
    .orderBy('e.final_rank')
    .execute();
}

/** A player's runs that count in a tournament, newest first. */
export async function myCountedRuns(deps: TournamentDeps, t: TournamentRow, accountId: string, limit = TOP): Promise<TournamentRunRow[]> {
  const [season, account] = await Promise.all([scoringSeason(deps.db, t), deps.config.get('account')]);
  const { rows } = await sql<{ id: string; finished_at: Date; sector: string; probe: string; coop_run_id: string | null; outcome: TournamentRunRow['outcome']; depth: number; kills: number; boss_kills: number; pts: number }>`
    select c.id, c.finished_at, c.sector, c.probe, c.coop_run_id, c.outcome, c.depth, c.kills, c.boss_kills, c.pts
    from (${countedRunsSql(scoringOf(t), season, account.minRunSeconds)}) c
    where c.account_id = ${accountId}
    order by c.finished_at desc
    limit ${limit}`.execute(deps.db);
  return rows.map((r) => ({
    id: r.id,
    finishedAt: new Date(r.finished_at).toISOString(),
    sector: r.sector,
    probe: r.probe,
    coop: r.coop_run_id !== null,
    outcome: r.outcome,
    depth: r.depth,
    kills: r.kills,
    cores: r.boss_kills,
    points: r.pts,
    value: runContribution(t.record.metric, { points: r.pts, kills: r.kills, depth: r.depth, cores: r.boss_kills, extracted: r.outcome === 'extracted' }),
  }));
}

/** GET /galaxy/api/tournaments/:slug. */
export async function tournamentDetail(deps: TournamentDeps, accountId: string, slug: string): Promise<TournamentDetail> {
  const now = deps.now();
  const t = await tournamentBySlug(deps.db, slug);
  const [viewer, counts] = await Promise.all([viewerOf(deps, accountId, [t.id]), entrantCounts(deps.db, [t.id])]);
  const entry = viewer.entries.get(t.id);
  const moving = t.state === 'running' || t.state === 'review';
  const live = moving ? await liveRanking(deps, t) : null;
  const card = cardOf(t, { entry, level: viewer.level, eligible: viewer.eligible, entrants: counts.get(t.id) ?? 0, exclusive: viewer.exclusive, ranking: live, now, accountId });

  let rows: (TournamentRankRow & { accountId: string })[] = [];
  if (live) {
    const places = awardPlaces(live.rows, t.record.prizes);
    rows = live.rows.map((r) => ({ accountId: r.accountId, rank: r.rank!, username: r.username, avatar: r.avatar, frame: r.frame, score: r.value, eligible: r.eligible, place: places.get(r.accountId) ?? null, me: r.accountId === accountId }));
  } else if (t.state === 'finished') {
    rows = (await frozenRanking(deps.db, t.id)).map((r) => ({
      accountId: r.account_id,
      rank: r.final_rank!,
      username: r.username,
      avatar: r.avatar,
      frame: r.frame,
      score: Number(r.final_score ?? 0),
      eligible: r.eligible ?? true,
      place: (r.rewards as TournamentRewards | null)?.place ?? null,
      me: r.account_id === accountId,
    }));
  }
  const strip = ({ accountId: _a, ...row }: TournamentRankRow & { accountId: string }): TournamentRankRow => row;
  const mine = rows.find((r) => r.me);
  const inIt = entry && !entry.left_at && !entry.disqualified;
  const myRuns = inIt && t.state !== 'scheduled' && t.state !== 'cancelled' ? await myCountedRuns(deps, t, accountId) : [];
  let review: TournamentDetail['review'] = null;
  if (t.state === 'review') {
    const c = await deps.db
      .selectFrom('galaxy.tournament_checks')
      .select([sql<number>`count(*)::int`.as('checks'), sql<number>`(count(*) filter (where status = 'pending' or (status in ('unverifiable', 'error') and decision is null)))::int`.as('pending')])
      .where('tournament_id', '=', t.id)
      .executeTakeFirstOrThrow();
    review = { checks: c.checks, pending: c.pending };
  }
  return {
    ...card,
    rules: t.record.rules,
    details: t.record.detailsMedia ? mediaUrl(t.record.detailsMedia) : null,
    reviewHours: t.record.reviewHours,
    ranking: rows.slice(0, TOP).map(strip),
    total: rows.length,
    mine: mine ? strip(mine) : null,
    myRuns,
    review,
  };
}

async function entryResult(trx: Kysely<DB>, deps: TournamentDeps, t: TournamentRow, accountId: string): Promise<TournamentEntryResult> {
  const e = await trx.selectFrom('galaxy.tournament_entries').select(ENTRY_FIELDS).where('tournament_id', '=', t.id).where('account_id', '=', accountId).executeTakeFirstOrThrow();
  const acc = await trx.selectFrom('galaxy.accounts').select('prize_eligible').where('id', '=', accountId).executeTakeFirstOrThrow();
  return { me: meOf(t, e as EntryRow, null, accountId, acc.prize_eligible)!, wallet: await getWallet(trx, accountId) };
}

/**
 * Signs up (POST …/:id/join): while it is scheduled or running and before its end, once (who left or was disqualified
 * never comes back), with the level and within the cap; in an exclusive tournament, never while in another exclusive
 * one whose dates overlap (checked under the account's own lock, so two at once cannot both get in). The fee is debited
 * with the request's key; from now on its runs count.
 */
export async function joinTournament(deps: TournamentDeps, accountId: string, id: string, key: string): Promise<TournamentEntryResult> {
  const account = await deps.config.get('account');
  const out = await runOperation(deps.db, accountId, key, 'tournament.join', requestHash({ tournament: id, action: 'join' }), async (trx) => {
    const now = deps.now();
    await entryLock(accountId).execute(trx);
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state === 'draft') throw new HttpError(404, 'tournament_not_found');
    const entry = (await trx.selectFrom('galaxy.tournament_entries').select(ENTRY_FIELDS).where('tournament_id', '=', id).where('account_id', '=', accountId).executeTakeFirst()) as EntryRow | undefined;
    // One after the other: a transaction is one connection.
    const level = t.record.filters.minLevel !== null ? await accountLevel(trx, accountId, account) : Number.POSITIVE_INFINITY;
    const entrants = (await entrantCounts(trx, [id])).get(id) ?? 0;
    const exclusive = t.record.exclusive ? await liveExclusives(trx, accountId, now) : [];
    const clash = exclusive.find((x) => x.id !== id && datesOverlap(x, t.record)) ?? null;
    const block = joinBlock(t, { entry, level, entrants, clash }, now);
    if (block === 'joined') throw new HttpError(409, 'tournament_joined');
    if (block === 'left') throw new HttpError(409, 'tournament_left');
    if (block === 'disqualified') throw new HttpError(409, 'tournament_disqualified');
    if (block === 'closed') throw new HttpError(409, 'tournament_closed');
    if (block === 'full') throw new HttpError(409, 'tournament_full');
    if (block === 'level') throw new HttpError(403, 'level_too_low', { minLevel: t.record.filters.minLevel });
    if (block === 'exclusive') throw new HttpError(409, 'tournament_exclusive', { slug: clash!.slug, title: clash!.title });
    const fee: TournamentFee | null = t.record.entry;
    if (fee) await debit(trx, accountId, fee.currency, fee.amount, 'tournament_entry', { tournament: id }, key);
    await trx
      .insertInto('galaxy.tournament_entries')
      .values({ tournament_id: id, account_id: accountId, joined_at: now, entry_key: key, fee: fee ? JSON.stringify(fee) : null })
      .execute();
    return entryResult(trx, deps, t, accountId);
  });
  invalidateTournament(id);
  return out;
}

/** Leaves (POST …/:id/leave): while it is scheduled or running; the score goes, the fee stays, and there is no way back. */
export async function leaveTournament(deps: TournamentDeps, accountId: string, id: string, key: string): Promise<TournamentEntryResult> {
  const out = await runOperation(deps.db, accountId, key, 'tournament.leave', requestHash({ tournament: id, action: 'leave' }), async (trx) => {
    const now = deps.now();
    await entryLock(accountId).execute(trx);
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state === 'draft') throw new HttpError(404, 'tournament_not_found');
    const e = await trx.selectFrom('galaxy.tournament_entries').select(['left_at', 'disqualified']).where('tournament_id', '=', id).where('account_id', '=', accountId).forUpdate().executeTakeFirst();
    if (!e) throw new HttpError(409, 'tournament_not_joined');
    if (e.left_at) throw new HttpError(409, 'tournament_left');
    if (e.disqualified) throw new HttpError(409, 'tournament_disqualified');
    if ((t.state !== 'scheduled' && t.state !== 'running') || Date.parse(t.record.endsAt) <= now.getTime()) throw new HttpError(409, 'tournament_closed');
    await trx.updateTable('galaxy.tournament_entries').set({ left_at: now }).where('tournament_id', '=', id).where('account_id', '=', accountId).execute();
    return entryResult(trx, deps, t, accountId);
  });
  invalidateTournament(id);
  return out;
}

/**
 * Collects a finished tournament's prizes (POST …/:id/claim), once: the entry's guarded `claimed_at` is the payer's own
 * guard row, and the galaxies' seeds come from the server's key for that entry, never from the request.
 */
export async function claimTournament(deps: TournamentDeps, accountId: string, id: string, key: string): Promise<TournamentClaimResult> {
  return runOperation(deps.db, accountId, key, 'tournament.claim', requestHash({ tournament: id, action: 'claim' }), async (trx) => {
    const now = deps.now();
    const t = await tournamentById(trx, id);
    if (t.state === 'draft') throw new HttpError(404, 'tournament_not_found');
    if (t.state !== 'finished') throw new HttpError(409, 'tournament_not_finished');
    const row = await trx
      .updateTable('galaxy.tournament_entries')
      .set({ claimed_at: now })
      .where('tournament_id', '=', id)
      .where('account_id', '=', accountId)
      .where('claimed_at', 'is', null)
      .where(sql<boolean>`jsonb_array_length(coalesce(rewards->'gifts', '[]'::jsonb)) > 0`)
      .returning('rewards')
      .executeTakeFirst();
    if (!row) {
      const had = await trx.selectFrom('galaxy.tournament_entries').select('claimed_at').where('tournament_id', '=', id).where('account_id', '=', accountId).executeTakeFirst();
      throw had?.claimed_at ? new HttpError(409, 'already_claimed') : new HttpError(404, 'tournament_no_prize');
    }
    const rewards = row.rewards as TournamentRewards;
    const { items } = await grantGifts(trx, accountId, rewards.gifts, {
      key: `tournament:${id}`,
      seedKey: `tournament:${id}:${accountId}`,
      reason: 'tournament_prize',
      ref: { tournament: id, place: rewards.place },
      actor: { id: accountId, label: 'torneo' },
      // Nothing seasonal is ever a tournament's prize (tournamentIssues).
      season: { id: t.record.seasonId, open: false },
      auditAction: 'tournament.prize',
    });
    return { items: items.map((i) => ({ gift: i.gift, outcome: i.outcome, ...(i.galaxies ? { galaxies: i.galaxies.map((g) => ({ id: g.id, name: g.name, tier: g.tier, finish: g.finish })) } : {}), ...(i.why ? { why: i.why } : {}) })), wallet: await getWallet(trx, accountId) };
  });
}
