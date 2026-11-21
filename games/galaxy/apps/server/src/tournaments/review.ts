import {
  type AdminTournament,
  type AdminTournamentCash,
  type AdminTournamentCheck,
  type AdminTournamentReview,
  awardPlaces,
  runContribution,
  type TournamentMetric,
  tournamentPath,
  type TournamentRewards,
  tournamentRewardsFor,
} from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { runReplay } from '../admin/runs';
import { guardTarget } from '../admin/players';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { invalidateLeaderboard } from '../social/leaderboard';
import { bigReasonsOf, type TournamentDeps } from './admin';
import { publishAt } from './player';
import { SYSTEM_ACTOR, scoringOf, scoringSeason, tournamentById, type TournamentRow } from './records';
import type { Replayer } from './replayer';
import { computeTournamentRanking, countedRunsSql, invalidateTournament, invalidateTournamentRankings } from './scoring';

// The review before any prize (plan «temporadas como fichas», part 5; GDD §13.3), the owner's rule: at its end a
// tournament's ranking stops moving and the solo runs that give its prize places are replayed on the server (group runs
// are already refereed as they are played). A run that does not match becomes suspicious (`replay_mismatch`), the
// ranking is computed again and whoever moves up into a prize has their runs queued too. A run that cannot be checked
// waits for an admin (accept or discard). The results publish when the review hours have passed and nothing is
// pending, or when an admin says «Publicar ya» with nothing pending: each entrant's place, score and rewards are frozen
// (who cannot win prizes keeps the place, the prize goes on), each winner gets a mail that leads to the tournament's page
// (in the same transaction, so a second pass sends nothing), and money prizes wait for an admin to mark them paid.

/** A check that still holds the results: not replayed yet, or not checkable and not decided. */
const BLOCKING = sql<boolean>`(k.status = 'pending' or (k.status in ('unverifiable', 'error') and k.decision is null))`;

async function blockingChecks(db: Kysely<DB>, id: string): Promise<number> {
  const r = await db.selectFrom('galaxy.tournament_checks as k').select(sql<number>`count(*)::int`.as('n')).where('k.tournament_id', '=', id).where(BLOCKING).executeTakeFirstOrThrow();
  return r.n;
}

/** The rules a tournament scores with: its season's points and the account's minimum run. */
async function scoringRules(deps: TournamentDeps, t: TournamentRow) {
  const [season, account] = await Promise.all([scoringSeason(deps.db, t), deps.config.get('account')]);
  return { season, minRunSeconds: account.minRunSeconds };
}

/** The ranking as it stands now, uncached (the review's decisions read it fresh). */
async function freshRanking(deps: TournamentDeps, t: TournamentRow) {
  const { season, minRunSeconds } = await scoringRules(deps, t);
  return { ranking: await computeTournamentRanking(deps.db, scoringOf(t), season, minRunSeconds), season, minRunSeconds };
}

/**
 * Queues the solo runs behind the prize places as they stand, those not queued yet: for one run's best (best_run,
 * depth) the run that gave it; for sums and counts every run that added something. Returns how many it added.
 */
export async function queueChecks(deps: TournamentDeps, t: TournamentRow): Promise<number> {
  const { ranking, season, minRunSeconds } = await freshRanking(deps, t);
  const places = awardPlaces(ranking.rows, t.record.prizes);
  const accounts = [...places.keys()];
  if (accounts.length === 0) return 0;
  const { rows } = await sql<{ id: string; account_id: string; coop_run_id: string | null; finished_at: Date; pts: number; kills: number; depth: number; boss_kills: number; outcome: string }>`
    select c.id, c.account_id, c.coop_run_id, c.finished_at, c.pts, c.kills, c.depth, c.boss_kills, c.outcome
    from (${countedRunsSql(scoringOf(t), season, minRunSeconds)}) c
    where c.account_id in (${sql.join(accounts)})`.execute(deps.db);
  const runs = runsToCheck(t.record.metric, rows.map((r) => ({ id: r.id, accountId: r.account_id, coop: r.coop_run_id !== null, finishedAt: new Date(r.finished_at).toISOString(), value: runContribution(t.record.metric, { points: r.pts, kills: r.kills, depth: r.depth, cores: r.boss_kills, extracted: r.outcome === 'extracted' }) })));
  if (runs.length === 0) return 0;
  const added = await deps.db
    .insertInto('galaxy.tournament_checks')
    .values(runs.map((run) => ({ tournament_id: t.id, run_id: run })))
    .onConflict((oc) => oc.columns(['tournament_id', 'run_id']).doNothing())
    .returning('run_id')
    .execute();
  return added.length;
}

/**
 * Which counted runs a prize place rests on: for a best (best_run, depth) the one that gave it (the highest, the first
 * to reach it), for sums and counts every one that added something. Group runs are never replayed here.
 */
export function runsToCheck(metric: TournamentMetric, runs: readonly { id: string; accountId: string; coop: boolean; finishedAt: string; value: number }[]): string[] {
  if (metric === 'best_run' || metric === 'depth') {
    const best = new Map<string, (typeof runs)[number]>();
    for (const r of runs) {
      const b = best.get(r.accountId);
      if (!b || r.value > b.value || (r.value === b.value && Date.parse(r.finishedAt) < Date.parse(b.finishedAt))) best.set(r.accountId, r);
    }
    return [...best.values()].filter((r) => !r.coop && r.value > 0).map((r) => r.id);
  }
  return runs.filter((r) => !r.coop && r.value > 0).map((r) => r.id);
}

/**
 * Replays the oldest pending check of a tournament in review and keeps its verdict (once: the check's guarded update).
 * A mismatch marks the run suspicious (audited) and queues whoever moves up. Returns false when nothing was pending.
 */
export async function processNextCheck(deps: TournamentDeps, replayer: Replayer): Promise<boolean> {
  const next = await deps.db
    .selectFrom('galaxy.tournament_checks as k')
    .innerJoin('galaxy.tournaments as t', 't.id', 'k.tournament_id')
    .select(['k.tournament_id', 'k.run_id'])
    .where('k.status', '=', 'pending')
    .where('t.state', '=', 'review')
    .orderBy('k.created_at')
    .orderBy('k.run_id')
    .limit(1)
    .executeTakeFirst();
  if (!next) return false;
  const data = await runReplay(deps.db, next.run_id);
  const verdict = await replayer.verify(data);
  const now = deps.now();
  const owner = await inTransaction(deps.db, async (trx) => {
    const done = await trx
      .updateTable('galaxy.tournament_checks')
      .set({ status: verdict.status, detail: JSON.stringify(verdict.detail), checked_at: now })
      .where('tournament_id', '=', next.tournament_id)
      .where('run_id', '=', next.run_id)
      .where('status', '=', 'pending')
      .returning('run_id')
      .executeTakeFirst();
    if (!done || verdict.status !== 'mismatch') return null;
    const run = await trx.selectFrom('galaxy.runs').select(['account_id', 'suspicious', 'flags']).where('id', '=', next.run_id).forUpdate().executeTakeFirstOrThrow();
    const flags = run.flags.includes('replay_mismatch') ? run.flags : [...run.flags, 'replay_mismatch'];
    await trx.updateTable('galaxy.runs').set({ suspicious: true, flags }).where('id', '=', next.run_id).execute();
    await writeAudit(trx, { actor: SYSTEM_ACTOR, action: 'run.replay_mismatch', targetType: 'run', targetId: next.run_id, before: { suspicious: run.suspicious, flags: run.flags }, after: { suspicious: true, flags, tournament: next.tournament_id }, reason: 'Revisión del torneo' });
    return run.account_id;
  });
  if (owner) {
    invalidateLeaderboard();
    invalidateTournamentRankings([owner]);
    await queueChecks(deps, await tournamentById(deps.db, next.tournament_id));
  }
  return true;
}

/** Replays pending checks one after another for at most `budgetMs`. Returns how many it did. */
export async function processChecks(deps: TournamentDeps, replayer: Replayer, budgetMs: number): Promise<number> {
  const until = Date.now() + budgetMs;
  let n = 0;
  while (Date.now() < until && (await processNextCheck(deps, replayer))) n++;
  return n;
}

const mustReview = (t: TournamentRow) => {
  if (t.state !== 'review') throw new HttpError(409, 'tournament_not_review');
};

/** An admin's decision on a run that could not be checked: accepted it counts; discarded it stops counting here. */
export async function decideCheck(deps: TournamentDeps, actor: AuditActor, id: string, runId: string, decision: 'accept' | 'discard', reason: string): Promise<void> {
  const t = await inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    mustReview(t);
    const k = await trx.selectFrom('galaxy.tournament_checks').select(['status', 'decision']).where('tournament_id', '=', id).where('run_id', '=', runId).forUpdate().executeTakeFirst();
    if (!k) throw new HttpError(404, 'tournament_check_not_found');
    if ((k.status !== 'unverifiable' && k.status !== 'error') || k.decision !== null) throw new HttpError(409, 'tournament_check_decided');
    await trx.updateTable('galaxy.tournament_checks').set({ decision, decided_by: actor.id, decided_at: deps.now() }).where('tournament_id', '=', id).where('run_id', '=', runId).execute();
    await writeAudit(trx, { actor, action: 'tournament.check_decided', targetType: 'tournament', targetId: id, after: { run: runId, status: k.status, decision }, reason });
    return t;
  });
  invalidateTournament(id);
  if (decision === 'discard') await queueChecks(deps, t);
}

/**
 * Disqualifies an entrant (or takes it back): while the tournament is scheduled, running or in review, with a reason,
 * audited. A disqualified entrant leaves the ranking (and pays its fee: a cancel does not return it); in review,
 * whoever moves up is queued.
 */
export async function disqualifyEntry(deps: TournamentDeps, s: SessionInfo, actor: AuditActor, id: string, username: string, disqualified: boolean, reason: string): Promise<void> {
  const target = await guardTarget(deps.db, s, username, { self: false });
  const t = await inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state === 'draft') throw new HttpError(404, 'tournament_not_found');
    if (t.state === 'finished' || t.state === 'cancelled') throw new HttpError(409, 'tournament_finished');
    const e = await trx.selectFrom('galaxy.tournament_entries').select(['disqualified']).where('tournament_id', '=', id).where('account_id', '=', target.id).forUpdate().executeTakeFirst();
    if (!e) throw new HttpError(404, 'tournament_not_joined');
    if (e.disqualified === disqualified) return t;
    await trx
      .updateTable('galaxy.tournament_entries')
      .set({ disqualified, disqualified_reason: disqualified ? reason : null })
      .where('tournament_id', '=', id)
      .where('account_id', '=', target.id)
      .execute();
    await writeAudit(trx, { actor, action: disqualified ? 'tournament.disqualified' : 'tournament.requalified', targetType: 'tournament', targetId: id, after: { account: target.id, username }, reason });
    return t;
  });
  invalidateTournament(id);
  if (t.state === 'review') await queueChecks(deps, t);
}

const num = new Intl.NumberFormat('es-ES');
const plural = (n: number, one: string, many: string) => `${num.format(n)} ${n === 1 ? one : many}`;

/** The score in words, measure by measure («con 1.234 puntos», «llegando a la capa 7»). */
export function scoreWords(metric: TournamentMetric, n: number): string {
  switch (metric) {
    case 'points':
    case 'season_points':
      return `con ${plural(n, 'punto', 'puntos')}`;
    case 'best_run':
      return `con una partida de ${plural(n, 'punto', 'puntos')}`;
    case 'kills':
      return `con ${plural(n, 'baja', 'bajas')}`;
    case 'runs':
      return `con ${plural(n, 'partida', 'partidas')}`;
    case 'depth':
      return `llegando a la capa ${num.format(n)}`;
    case 'cores':
      return `con ${plural(n, 'Núcleo', 'Núcleos')}`;
    case 'extractions':
      return `con ${plural(n, 'extracción', 'extracciones')}`;
  }
}

/** The mail each winner gets when the results are out (a `tournament` message: its button opens the tournament). */
export function resultsMail(title: string, metric: TournamentMetric, who: { rank: number | null; score: number; runs: number; rewards: TournamentRewards }): { title: string; body: string } {
  const parts: string[] = [];
  if (who.rank !== null && who.rewards.place !== null) parts.push(`Quedaste ${num.format(who.rank)}.º ${scoreWords(metric, who.score)}`);
  else parts.push(`Jugaste ${plural(who.runs, 'partida', 'partidas')} en el torneo`);
  if (who.rewards.gifts.length > 0) parts.push(who.rewards.place !== null ? 'Tus premios te esperan en la página del torneo' : 'Tu premio de participación te espera en la página del torneo');
  if (who.rewards.cash) parts.push('Un admin te escribirá por el buzón para el premio en metálico');
  return { title: `${title} ha terminado`.slice(0, 80), body: parts.join('. ') };
}

/**
 * Publishes a tournament's results when it can: in review, with nothing pending (any prize place's run not queued yet
 * is queued first), and its review hours over — or, `force` («Publicar ya»), before them. Freezes every live entrant's
 * place, score, runs and rewards, lists the money owed, sends each winner a mail and finishes the tournament, all in one
 * transaction under its lock: a second call publishes nothing. Returns whether it published.
 */
export async function finishTournament(deps: TournamentDeps, id: string, opts: { force?: boolean; actor?: AuditActor; reason?: string } = {}): Promise<boolean> {
  const now = deps.now();
  const t = await tournamentById(deps.db, id);
  if (t.state !== 'review') {
    if (opts.force) mustReview(t);
    return false;
  }
  const added = await queueChecks(deps, t);
  const pending = await blockingChecks(deps.db, id);
  if (added > 0 || pending > 0) {
    if (opts.force) throw new HttpError(409, 'tournament_pending', { pending: Math.max(pending, added) });
    return false;
  }
  if (!opts.force && now.getTime() < Date.parse(publishAt(t))) return false;
  // Read with the pool before the transaction; inside it, only the ranking (under the tournament's lock).
  const { season, minRunSeconds } = await scoringRules(deps, t);
  const out = await inTransaction(deps.db, async (trx) => {
    const locked = await tournamentById(trx, id, { lock: true });
    if (locked.state !== 'review') return null;
    // Anything queued meanwhile (a disqualification, a decision) waits again.
    if ((await blockingChecks(trx, id)) > 0) {
      if (opts.force) throw new HttpError(409, 'tournament_pending', { pending: await blockingChecks(trx, id) });
      return null;
    }
    const ranking = await computeTournamentRanking(trx, scoringOf(locked), season, minRunSeconds);
    const places = awardPlaces(ranking.rows, locked.record.prizes);
    const results = [...ranking.entrants.values()].map((e) => {
      const place = places.get(e.accountId) ?? null;
      return { accountId: e.accountId, username: e.username, rank: e.rank, score: e.value, runs: e.runs, eligible: e.eligible, rewards: tournamentRewardsFor(locked.record, { place, runs: e.runs, eligible: e.eligible }) };
    });
    if (results.length > 0) {
      await sql`
        update galaxy.tournament_entries e
           set final_rank = x.rank, final_score = x.score, final_runs = x.runs, eligible = x.eligible, rewards = x.rewards
          from jsonb_to_recordset(${JSON.stringify(results.map((r) => ({ account_id: r.accountId, rank: r.rank, score: r.score, runs: r.runs, eligible: r.eligible, rewards: r.rewards })))}::jsonb)
               as x(account_id uuid, rank integer, score bigint, runs integer, eligible boolean, rewards jsonb)
         where e.tournament_id = ${id} and e.account_id = x.account_id`.execute(trx);
    }
    const cash = results.filter((r) => r.rewards?.cash && r.rank !== null);
    if (cash.length > 0) {
      await trx
        .insertInto('galaxy.tournament_cash')
        .values(cash.map((r) => ({ tournament_id: id, account_id: r.accountId, rank: r.rank!, amount_eur: r.rewards!.cash!.amountEur, note: r.rewards!.cash!.note })))
        .onConflict((oc) => oc.columns(['tournament_id', 'account_id']).doNothing())
        .execute();
    }
    // Each winner's mail, in the same transaction as the state change: a pass that runs again sends nothing.
    const winners = results.filter((r): r is typeof r & { rewards: TournamentRewards } => r.rewards !== null);
    for (let i = 0; i < winners.length; i += 500) {
      const chunk = winners.slice(i, i + 500);
      const mails = chunk.map((w) => resultsMail(locked.record.title, locked.record.metric, w));
      const made = await trx
        .insertInto('galaxy.mailbox_messages')
        .values(
          chunk.map((w, k) => ({
            title: mails[k]!.title,
            body: mails[k]!.body,
            gifts: '{}',
            type: 'tournament' as const,
            link: tournamentPath(locked.record.slug),
            audience: JSON.stringify({ kind: 'segment', usernames: [w.username.toLowerCase()] }),
            created_by: null,
            created_at: sql<Date>`now()`,
            expires_at: sql<Date>`now() + interval '60 days'`,
          })),
        )
        .returning('id')
        .execute();
      await trx.insertInto('galaxy.mailbox_receipts').values(made.map((m, k) => ({ message_id: m.id, account_id: chunk[k]!.accountId }))).execute();
    }
    await trx.updateTable('galaxy.tournaments').set({ state: 'finished', published_at: now, version: locked.version + 1, updated_at: sql`now()` }).where('id', '=', id).execute();
    await writeAudit(trx, {
      actor: opts.actor ?? SYSTEM_ACTOR,
      action: 'tournament.published',
      targetType: 'tournament',
      targetId: id,
      after: { ranked: ranking.rows.length, winners: winners.length, cash: cash.length, forced: !!opts.force },
      reason: opts.reason ?? 'Resultados publicados al acabar la revisión',
    });
    return { record: locked.record, entrants: results.map((r) => r.accountId) };
  });
  if (!out) return false;
  invalidateTournament(id);
  deps.live?.sendMany(out.entrants, { type: 'notice', notice: { kind: 'tournament', event: 'finished', id, slug: out.record.slug, title: out.record.title } });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// The panel's views.

/** A tournament as the panel lists it, with its counts. */
export async function adminTournamentOf(deps: TournamentDeps, t: TournamentRow): Promise<AdminTournament> {
  const [counts, checks, cash, names] = await Promise.all([
    deps.db
      .selectFrom('galaxy.tournament_entries')
      .select([
        sql<number>`(count(*) filter (where left_at is null and not disqualified))::int`.as('entrants'),
        sql<number>`(count(*) filter (where left_at is not null))::int`.as('left'),
        sql<number>`(count(*) filter (where disqualified))::int`.as('disqualified'),
      ])
      .where('tournament_id', '=', t.id)
      .executeTakeFirstOrThrow(),
    deps.db
      .selectFrom('galaxy.tournament_checks')
      .select([sql<number>`(count(*) filter (where status = 'pending'))::int`.as('pending'), sql<number>`(count(*) filter (where status in ('unverifiable', 'error') and decision is null))::int`.as('undecided')])
      .where('tournament_id', '=', t.id)
      .executeTakeFirstOrThrow(),
    deps.db.selectFrom('galaxy.tournament_cash').select(sql<number>`count(*)::int`.as('n')).where('tournament_id', '=', t.id).where('paid_at', 'is', null).executeTakeFirstOrThrow(),
    usernames(deps.db, [t.createdBy, t.updatedBy, t.scheduledBy]),
  ]);
  return {
    id: t.id,
    state: t.state,
    version: t.version,
    record: t.record,
    createdAt: t.createdAt,
    createdBy: t.createdBy ? (names.get(t.createdBy) ?? null) : null,
    updatedAt: t.updatedAt,
    updatedBy: t.updatedBy ? (names.get(t.updatedBy) ?? null) : null,
    scheduledAt: t.scheduledAt,
    scheduledBy: t.scheduledBy ? (names.get(t.scheduledBy) ?? null) : null,
    publishedAt: t.publishedAt,
    entrants: counts.entrants,
    left: counts.left,
    disqualified: counts.disqualified,
    pending: checks.pending,
    undecided: checks.undecided,
    cashPending: cash.n,
    bigReasons: await bigReasonsOf(deps.config, t.record),
  };
}

async function usernames(db: Kysely<DB>, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Map();
  const rows = await db.selectFrom('galaxy.accounts').select(['id', 'username']).where('id', 'in', wanted).execute();
  return new Map(rows.map((r) => [r.id, r.username]));
}

type CashRow = { tournament_id: string; slug: string; title: string; username: string; rank: number; amount_eur: string; note: string; paid_at: Date | null; paid_by: string | null };
const cashOf = (r: CashRow, names: Map<string, string>): AdminTournamentCash => ({
  tournamentId: r.tournament_id,
  slug: r.slug,
  title: r.title,
  username: r.username,
  rank: r.rank,
  amountEur: Number(r.amount_eur),
  note: r.note,
  paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  paidBy: r.paid_by ? (names.get(r.paid_by) ?? null) : null,
});

/** Money prizes, still to pay first, then the paid ones (one tournament's, or every tournament's). */
export async function cashPrizes(db: Kysely<DB>, tournamentId?: string): Promise<AdminTournamentCash[]> {
  let q = db
    .selectFrom('galaxy.tournament_cash as c')
    .innerJoin('galaxy.tournaments as t', 't.id', 'c.tournament_id')
    .innerJoin('galaxy.accounts as a', 'a.id', 'c.account_id')
    .select(['c.tournament_id', 't.slug', 't.title', 'a.username', 'c.rank', 'c.amount_eur', 'c.note', 'c.paid_at', 'c.paid_by']);
  if (tournamentId) q = q.where('c.tournament_id', '=', tournamentId);
  const rows = await q.orderBy(sql`c.paid_at is not null`).orderBy('c.created_at', 'desc').orderBy('c.rank').limit(500).execute();
  const names = await usernames(db, rows.map((r) => r.paid_by));
  return rows.map((r) => cashOf(r, names));
}

/** Marks a money prize paid (once, audited): the game never pays money, an admin does it outside and says so here. */
export async function markCashPaid(deps: TournamentDeps, actor: AuditActor, id: string, username: string, reason: string): Promise<AdminTournamentCash> {
  return inTransaction(deps.db, async (trx) => {
    const a = await trx.selectFrom('galaxy.accounts').select('id').where(sql<string>`lower(username)`, '=', username.toLowerCase()).executeTakeFirst();
    if (!a) throw new HttpError(404, 'player_not_found');
    const c = await trx.selectFrom('galaxy.tournament_cash').select(['paid_at', 'amount_eur', 'rank']).where('tournament_id', '=', id).where('account_id', '=', a.id).forUpdate().executeTakeFirst();
    if (!c) throw new HttpError(404, 'tournament_cash_not_found');
    if (c.paid_at) throw new HttpError(409, 'tournament_cash_paid');
    await trx.updateTable('galaxy.tournament_cash').set({ paid_at: deps.now(), paid_by: actor.id }).where('tournament_id', '=', id).where('account_id', '=', a.id).execute();
    await writeAudit(trx, { actor, action: 'tournament.cash_paid', targetType: 'tournament', targetId: id, after: { account: a.id, username, rank: c.rank, amountEur: Number(c.amount_eur) }, reason });
    return (await cashPrizes(trx, id)).find((x) => x.username.toLowerCase() === username.toLowerCase())!;
  });
}

/** GET …/admin/tournaments/:id/review: the ranking with what each would take, the checks, the disqualified, the money. */
export async function reviewView(deps: TournamentDeps, id: string): Promise<AdminTournamentReview> {
  const t = await tournamentById(deps.db, id);
  let ranking: AdminTournamentReview['ranking'] = [];
  if (t.state === 'finished') {
    const rows = await deps.db
      .selectFrom('galaxy.tournament_entries as e')
      .innerJoin('galaxy.accounts as a', 'a.id', 'e.account_id')
      .select(['a.username', 'a.avatar', 'a.frame', 'e.final_rank', 'e.final_score', 'e.final_runs', 'e.eligible', 'e.rewards'])
      .where('e.tournament_id', '=', id)
      .where('e.final_rank', 'is not', null)
      .orderBy('e.final_rank')
      .execute();
    ranking = rows.map((r) => {
      const rewards = (r.rewards as TournamentRewards | null) ?? null;
      return { rank: r.final_rank!, username: r.username, avatar: r.avatar, frame: r.frame, score: Number(r.final_score ?? 0), eligible: r.eligible ?? true, place: rewards?.place ?? null, runs: r.final_runs ?? 0, rewards };
    });
  } else if (t.state !== 'draft') {
    const { ranking: live } = await freshRanking(deps, t);
    const places = awardPlaces(live.rows, t.record.prizes);
    ranking = live.rows.map((r) => {
      const place = places.get(r.accountId) ?? null;
      return { rank: r.rank!, username: r.username, avatar: r.avatar, frame: r.frame, score: r.value, eligible: r.eligible, place, runs: r.runs, rewards: tournamentRewardsFor(t.record, { place, runs: r.runs, eligible: r.eligible }) };
    });
  }
  const checks = await deps.db
    .selectFrom('galaxy.tournament_checks as k')
    .innerJoin('galaxy.runs as r', 'r.id', 'k.run_id')
    .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
    .select(['k.run_id', 'a.username', 'r.finished_at', 'k.status', 'k.detail', 'k.decision', 'k.decided_by', 'k.decided_at', 'k.checked_at'])
    .where('k.tournament_id', '=', id)
    .orderBy('k.created_at')
    .orderBy('k.run_id')
    .execute();
  const names = await usernames(deps.db, checks.map((c) => c.decided_by));
  const disqualified = await deps.db
    .selectFrom('galaxy.tournament_entries as e')
    .innerJoin('galaxy.accounts as a', 'a.id', 'e.account_id')
    .select(['a.username', 'e.disqualified_reason'])
    .where('e.tournament_id', '=', id)
    .where('e.disqualified', '=', true)
    .orderBy('a.username')
    .execute();
  const rows: AdminTournamentCheck[] = checks.map((c) => ({
    runId: c.run_id,
    username: c.username,
    finishedAt: c.finished_at ? c.finished_at.toISOString() : '',
    status: c.status,
    detail: (c.detail as AdminTournamentCheck['detail']) ?? null,
    decision: c.decision,
    decidedBy: c.decided_by ? (names.get(c.decided_by) ?? null) : null,
    decidedAt: c.decided_at ? c.decided_at.toISOString() : null,
    checkedAt: c.checked_at ? c.checked_at.toISOString() : null,
  }));
  const blocking = rows.filter((c) => c.status === 'pending' || ((c.status === 'unverifiable' || c.status === 'error') && c.decision === null)).length;
  return {
    tournament: await adminTournamentOf(deps, t),
    ranking,
    checks: rows,
    disqualified: disqualified.map((d) => ({ username: d.username, reason: d.disqualified_reason })),
    publishAt: publishAt(t),
    canPublish: t.state === 'review' && blocking === 0,
    cash: await cashPrizes(deps.db, id),
  };
}
