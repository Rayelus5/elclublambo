import {
  type AdminTournament,
  type AdminTournamentCash,
  type AdminTournamentCheck,
  type AdminTournamentReview,
  awardPlaces,
  choiceNeedsPick,
  datesOverlap,
  hasPrizeToCollect,
  runContribution,
  type SeasonConfig,
  type TournamentDecideManyResult,
  type TournamentMetric,
  tournamentPath,
  type TournamentRewards,
  tournamentRewardsFor,
  type UnverifiableGroups,
  type UnverifiableReason,
} from '@galaxy/shared';
import { SIM_VERSION } from '@galaxy/sim';
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
import { liveExclusives, publishAt } from './player';
import { entryLock, SYSTEM_ACTOR, scoringOf, scoringSeason, tournamentById, type TournamentRow } from './records';
import { type ReplayOutcome, type Replayer, retryOf } from './replayer';
import { computeTournamentRanking, countedRunsSql, invalidateTournament, invalidateTournamentRankings, type TournamentRanking } from './scoring';

// The review before any prize (plan «temporadas como fichas», part 5; GDD §13.3), the owner's rule: at its end a
// tournament's ranking stops moving and the solo runs that give its prize places are replayed on the server (group runs
// are already refereed as they are played). A run that does not match becomes suspicious (`replay_mismatch`), the
// ranking is computed again and whoever moves up into a prize has their runs queued too. A run that cannot be checked
// waits for an admin (accept or discard, one by one or in bulk). Only the runs behind the prize places as they stand hold
// the results: a check of someone who left the prizes stays as it is and is no longer replayed. The results publish when
// the review hours have passed and nothing holds them, or when an admin says «Publicar ya»: under the tournament's lock,
// the prize places are checked once more against the ranking they are frozen from, each entrant's place, score and
// rewards are frozen (who cannot win prizes keeps the place, the prize goes on), each winner gets a mail that leads to the
// tournament's page (in the same transaction, so a second pass sends nothing), and money prizes wait for an admin to mark
// them paid. Every change that can move a prize place (a mismatch, a decision, a disqualification) queues whoever moves
// up in its own transaction, under the same lock.

/** The rules a tournament scores with: its season's points and the account's minimum run. */
export interface ScoringRules {
  season: SeasonConfig;
  minRunSeconds: number;
}

export async function scoringRules(deps: TournamentDeps, t: TournamentRow): Promise<ScoringRules> {
  const [season, account] = await Promise.all([scoringSeason(deps.db, t), deps.config.get('account')]);
  return { season, minRunSeconds: account.minRunSeconds };
}

/** A check that holds the results: not replayed yet, or not checkable and not decided. */
const holds = (k: { status: string; decision: string | null }) => k.status === 'pending' || ((k.status === 'unverifiable' || k.status === 'error') && k.decision === null);

/** The prize places as the ranking stands on `db` (a transaction's view when it is one), and the runs they rest on. */
export async function prizeBacking(db: Kysely<DB>, t: TournamentRow, rules: ScoringRules): Promise<{ ranking: TournamentRanking; places: Map<string, number>; runs: string[] }> {
  const ranking = await computeTournamentRanking(db, scoringOf(t), rules.season, rules.minRunSeconds);
  const places = awardPlaces(ranking.rows, t.record.prizes);
  const accounts = [...places.keys()];
  if (accounts.length === 0) return { ranking, places, runs: [] };
  const { rows } = await sql<{ id: string; account_id: string; coop_run_id: string | null; finished_at: Date; pts: number; kills: number; depth: number; boss_kills: number; outcome: string }>`
    select c.id, c.account_id, c.coop_run_id, c.finished_at, c.pts, c.kills, c.depth, c.boss_kills, c.outcome
    from (${countedRunsSql(scoringOf(t), rules.season, rules.minRunSeconds)}) c
    where c.account_id in (${sql.join(accounts)})`.execute(db);
  const runs = runsToCheck(
    t.record.metric,
    rows.map((r) => ({ id: r.id, accountId: r.account_id, coop: r.coop_run_id !== null, finishedAt: new Date(r.finished_at).toISOString(), value: runContribution(t.record.metric, { points: r.pts, kills: r.kills, depth: r.depth, cores: r.boss_kills, extracted: r.outcome === 'extracted' }) })),
  );
  return { ranking, places, runs };
}

/**
 * Queues on `db` every run the prize places rest on that has no check yet, and counts what holds the results: those
 * runs' checks still to replay or to decide (the new ones included).
 */
export async function ensureChecks(db: Kysely<DB>, t: TournamentRow, rules: ScoringRules): Promise<{ ranking: TournamentRanking; places: Map<string, number>; runs: string[]; added: number; blocking: number }> {
  const b = await prizeBacking(db, t, rules);
  if (b.runs.length === 0) return { ...b, added: 0, blocking: 0 };
  const added = await db
    .insertInto('galaxy.tournament_checks')
    .values(b.runs.map((run) => ({ tournament_id: t.id, run_id: run })))
    .onConflict((oc) => oc.columns(['tournament_id', 'run_id']).doNothing())
    .returning('run_id')
    .execute();
  const checks = await db.selectFrom('galaxy.tournament_checks').select(['run_id', 'status', 'decision']).where('tournament_id', '=', t.id).where('run_id', 'in', b.runs).execute();
  const blocking = checks.filter(holds).length + (b.runs.length - checks.length);
  return { ...b, added: added.length, blocking };
}

/** Queues the runs behind the prize places as they stand that are not queued yet. Returns how many it added. */
export async function queueChecks(deps: TournamentDeps, t: TournamentRow): Promise<number> {
  return (await ensureChecks(deps.db, t, await scoringRules(deps, t))).added;
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
 * The next check to replay: of the tournaments in review, oldest pending first, a pending check behind a prize place as
 * it stands (fewest tries first). `only`: one tournament's.
 */
async function nextCheck(deps: TournamentDeps, only?: string): Promise<{ t: TournamentRow; rules: ScoringRules; runId: string; attempts: number } | null> {
  let q = deps.db
    .selectFrom('galaxy.tournament_checks as k')
    .innerJoin('galaxy.tournaments as t', 't.id', 'k.tournament_id')
    .select(['k.tournament_id', sql<Date>`min(k.created_at)`.as('first')])
    .where('k.status', '=', 'pending')
    .where('t.state', '=', 'review');
  if (only) q = q.where('k.tournament_id', '=', only);
  const waiting = await q.groupBy('k.tournament_id').orderBy('first').execute();
  for (const w of waiting) {
    const t = await tournamentById(deps.db, w.tournament_id);
    const rules = await scoringRules(deps, t);
    const { runs } = await prizeBacking(deps.db, t, rules);
    if (runs.length === 0) continue;
    const k = await deps.db
      .selectFrom('galaxy.tournament_checks')
      .select(['run_id', 'attempts'])
      .where('tournament_id', '=', t.id)
      .where('status', '=', 'pending')
      .where('run_id', 'in', runs)
      .orderBy('attempts')
      .orderBy('created_at')
      .orderBy('run_id')
      .limit(1)
      .executeTakeFirst();
    if (k) return { t, rules, runId: k.run_id, attempts: k.attempts };
  }
  return null;
}

/** What one step of the queue did: replayed one (or tried to), found nothing to replay, or was stopped by a shutdown. */
export type CheckStep = 'done' | 'none' | 'aborted';

/**
 * Replays the next check and keeps its verdict (once: the check's guarded update), under the tournament's lock. A
 * mismatch marks the run suspicious (audited) and queues whoever moves up, in the same transaction. A worker that died
 * or ran out of time leaves the check pending for another try (an error after three); a shutdown leaves it untouched.
 */
export async function processNextCheck(deps: TournamentDeps, replayer: Replayer, opts: { tournament?: string } = {}): Promise<CheckStep> {
  const next = await nextCheck(deps, opts.tournament);
  if (!next) return 'none';
  let verdict: ReplayOutcome;
  try {
    verdict = await replayer.verify(await runReplay(deps.db, next.runId));
  } catch (err) {
    // What the run kept cannot be read back at all: an error an admin decides on (trying again would fail the same way).
    verdict = { status: 'error', detail: { reason: (err as Error).name || 'replay_data' } };
  }
  if (verdict.status === 'aborted') return 'aborted';
  const v = verdict;
  const now = deps.now();
  const owner = await inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, next.t.id, { lock: true });
    const pending = () => trx.updateTable('galaxy.tournament_checks').where('tournament_id', '=', t.id).where('run_id', '=', next.runId).where('status', '=', 'pending');
    if (retryOf(v, next.attempts)) {
      await pending().set({ attempts: next.attempts + 1, detail: JSON.stringify(v.detail) }).execute();
      return null;
    }
    const done = await pending().set({ status: v.status, detail: JSON.stringify(v.detail), checked_at: now, attempts: next.attempts + 1 }).returning('run_id').executeTakeFirst();
    if (!done || v.status !== 'mismatch') return null;
    const run = await trx.selectFrom('galaxy.runs').select(['account_id', 'suspicious', 'flags']).where('id', '=', next.runId).forUpdate().executeTakeFirstOrThrow();
    const flags = run.flags.includes('replay_mismatch') ? run.flags : [...run.flags, 'replay_mismatch'];
    await trx.updateTable('galaxy.runs').set({ suspicious: true, flags }).where('id', '=', next.runId).execute();
    await writeAudit(trx, { actor: SYSTEM_ACTOR, action: 'run.replay_mismatch', targetType: 'run', targetId: next.runId, before: { suspicious: run.suspicious, flags: run.flags }, after: { suspicious: true, flags, tournament: t.id }, reason: 'Revisión del torneo' });
    // Whoever moves up into a prize, queued before anything can publish.
    if (t.state === 'review') await ensureChecks(trx, t, next.rules);
    return run.account_id;
  });
  if (owner) {
    invalidateLeaderboard();
    invalidateTournamentRankings([owner]);
  }
  return 'done';
}

/** Replays checks one after another for at most `budgetMs`; stops when nothing is left or the replayer closed. */
export async function processChecks(deps: TournamentDeps, replayer: Replayer, budgetMs: number): Promise<number> {
  const until = Date.now() + budgetMs;
  let n = 0;
  while (Date.now() < until) {
    if ((await processNextCheck(deps, replayer)) !== 'done') break;
    n++;
  }
  return n;
}

const mustReview = (t: TournamentRow) => {
  if (t.state !== 'review') throw new HttpError(409, 'tournament_not_review');
};

/**
 * Why an admin may not decide a check of a run of `ownerId` (with `ownerRoles`), or null. Not guardTarget's rule (the
 * owner, 2026-11-22): admins can win prizes, so a superadmin's run that cannot be checked would hold the results forever.
 * One's own run may only be discarded (that only hurts oneself; accepting it takes someone else or the server's CLI); a
 * superadmin's, another superadmin decides; other staff's, a superadmin; a player's, any admin.
 */
export function checkBlock(s: Pick<SessionInfo, 'accountId' | 'roles'>, ownerId: string, ownerRoles: readonly string[], decision: 'accept' | 'discard'): 'tournament_self_accept' | 'staff_target' | null {
  if (ownerId === s.accountId) return decision === 'discard' ? null : 'tournament_self_accept';
  if (ownerRoles.length > 0 && !s.roles.includes('superadmin')) return 'staff_target';
  return null;
}

/**
 * A decision on a run that could not be checked (unverifiable, or an error): accepted it counts; discarded it stops
 * counting here and whoever moves up is queued in the same transaction. An admin's (`s`) only where checkBlock lets them;
 * the server's CLI (`s` null, trusted like every container command) on any run.
 */
export async function decideCheck(deps: TournamentDeps, s: SessionInfo | null, actor: AuditActor, id: string, runId: string, decision: 'accept' | 'discard', reason: string): Promise<void> {
  const rules = await scoringRules(deps, await tournamentById(deps.db, id));
  await inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    mustReview(t);
    const k = await trx.selectFrom('galaxy.tournament_checks').select(['status', 'decision']).where('tournament_id', '=', id).where('run_id', '=', runId).forUpdate().executeTakeFirst();
    if (!k) throw new HttpError(404, 'tournament_check_not_found');
    if ((k.status !== 'unverifiable' && k.status !== 'error') || k.decision !== null) throw new HttpError(409, 'tournament_check_decided');
    if (s) {
      const owner = await trx.selectFrom('galaxy.runs').select('account_id').where('id', '=', runId).executeTakeFirstOrThrow();
      const roles = await trx.selectFrom('galaxy.account_roles').select('role').where('account_id', '=', owner.account_id).execute();
      const why = checkBlock(s, owner.account_id, roles.map((r) => r.role as string), decision);
      if (why) throw new HttpError(403, why);
    }
    await trx.updateTable('galaxy.tournament_checks').set({ decision, decided_by: actor.id, decided_at: deps.now() }).where('tournament_id', '=', id).where('run_id', '=', runId).execute();
    await writeAudit(trx, { actor, action: 'tournament.check_decided', targetType: 'tournament', targetId: id, after: { run: runId, status: k.status, decision }, reason });
    if (decision === 'discard') await ensureChecks(trx, t, rules);
  });
  invalidateTournament(id);
}

/**
 * Decides in one go every undecided `unverifiable` check of a tournament in review that matches the filter (its reason,
 * its player): never a mismatch or an error, those one by one. A run the admin may not decide (checkBlock: their own when
 * accepting, staff's they may not touch) is skipped and listed. One transaction under the tournament's lock, one audit
 * entry with the count and the filter, and whoever moves up after a discard queued in it.
 */
export async function decideMany(
  deps: TournamentDeps,
  s: SessionInfo,
  actor: AuditActor,
  id: string,
  decision: 'accept' | 'discard',
  filter: { reason?: UnverifiableReason; username?: string },
  reason: string,
): Promise<TournamentDecideManyResult> {
  const rules = await scoringRules(deps, await tournamentById(deps.db, id));
  const out = await inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    mustReview(t);
    let q = trx
      .selectFrom('galaxy.tournament_checks as k')
      .innerJoin('galaxy.runs as r', 'r.id', 'k.run_id')
      .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
      .select(['k.run_id', 'r.account_id', 'a.username'])
      .where('k.tournament_id', '=', id)
      .where('k.status', '=', 'unverifiable')
      .where('k.decision', 'is', null);
    if (filter.reason) q = q.where(sql<string>`k.detail->>'reason'`, '=', filter.reason);
    if (filter.username) q = q.where(sql<string>`lower(a.username)`, '=', filter.username.toLowerCase());
    // The tournament's lock is what every decision and every verdict takes first: no row lock needed here.
    const found = await q.orderBy('k.created_at').orderBy('k.run_id').execute();
    const owners = [...new Set(found.map((f) => f.account_id))];
    const roles = owners.length > 0 ? await trx.selectFrom('galaxy.account_roles').select(['account_id', 'role']).where('account_id', 'in', owners).execute() : [];
    const rolesOf = (owner: string) => roles.filter((r) => r.account_id === owner).map((r) => r.role as string);
    const skipped: TournamentDecideManyResult['skipped'] = [];
    const chosen: string[] = [];
    for (const f of found) {
      const why = checkBlock(s, f.account_id, rolesOf(f.account_id), decision);
      if (why) skipped.push({ runId: f.run_id, username: f.username, why });
      else chosen.push(f.run_id);
    }
    if (chosen.length > 0) {
      await trx.updateTable('galaxy.tournament_checks').set({ decision, decided_by: actor.id, decided_at: deps.now() }).where('tournament_id', '=', id).where('run_id', 'in', chosen).execute();
    }
    await writeAudit(trx, { actor, action: 'tournament.checks_decided', targetType: 'tournament', targetId: id, after: { decision, filter, decided: chosen.length, skipped: skipped.length }, reason });
    if (decision === 'discard' && chosen.length > 0) await ensureChecks(trx, t, rules);
    return { decided: chosen.length, skipped };
  });
  invalidateTournament(id);
  return { ...(await reviewView(deps, id)), ...out };
}

/**
 * Disqualifies an entrant (or takes it back): while the tournament is scheduled, running or in review, with a reason,
 * audited. A disqualified entrant leaves the ranking (and pays its fee: a cancel does not return it); in review, whoever
 * moves up is queued in the same transaction. Taking one back is a sign-up again: under the account's own lock (as a
 * sign-up), and never while it is in another exclusive tournament whose dates overlap.
 */
export async function disqualifyEntry(deps: TournamentDeps, s: SessionInfo, actor: AuditActor, id: string, username: string, disqualified: boolean, reason: string): Promise<void> {
  const target = await guardTarget(deps.db, s, username, { self: false });
  const before = await tournamentById(deps.db, id);
  const rules = before.state === 'review' ? await scoringRules(deps, before) : null;
  await inTransaction(deps.db, async (trx) => {
    // The account's lock first, then the tournament's: the order a sign-up takes them in.
    await entryLock(target.id).execute(trx);
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state === 'draft') throw new HttpError(404, 'tournament_not_found');
    if (t.state === 'finished' || t.state === 'cancelled') throw new HttpError(409, 'tournament_finished');
    const e = await trx.selectFrom('galaxy.tournament_entries').select(['disqualified', 'left_at']).where('tournament_id', '=', id).where('account_id', '=', target.id).forUpdate().executeTakeFirst();
    if (!e) throw new HttpError(404, 'tournament_not_joined');
    if (e.disqualified === disqualified) return;
    if (!disqualified && t.record.exclusive && !e.left_at) {
      const clash = (await liveExclusives(trx, target.id, deps.now())).find((x) => x.id !== id && datesOverlap(x, t.record));
      if (clash) throw new HttpError(409, 'tournament_exclusive', { slug: clash.slug, title: clash.title });
    }
    await trx
      .updateTable('galaxy.tournament_entries')
      .set({ disqualified, disqualified_reason: disqualified ? reason : null })
      .where('tournament_id', '=', id)
      .where('account_id', '=', target.id)
      .execute();
    await writeAudit(trx, { actor, action: disqualified ? 'tournament.disqualified' : 'tournament.requalified', targetType: 'tournament', targetId: id, after: { account: target.id, username }, reason });
    if (t.state === 'review' && rules) await ensureChecks(trx, t, rules);
  });
  invalidateTournament(id);
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
  // Whether they will have to pick is only known when they collect (what they own by then); the prize tells if it can.
  const pick = !!who.rewards.choice && choiceNeedsPick(who.rewards.choice);
  if (hasPrizeToCollect(who.rewards))
    parts.push(who.rewards.place === null ? 'Tu premio de participación te espera en la página del torneo' : pick ? 'Tus premios te esperan en la página del torneo, donde eliges tus skins' : 'Tus premios te esperan en la página del torneo');
  if (who.rewards.cash) parts.push('Un admin te escribirá por el buzón para el premio en metálico');
  return { title: `${title} ha terminado`.slice(0, 80), body: parts.join('. ') };
}

/** Two computations of a ranking gave the same: every entrant's score, runs and whether it can win prizes. */
function sameRanking(a: TournamentRanking, b: TournamentRanking): boolean {
  const key = (r: TournamentRanking) => JSON.stringify([...r.entrants.values()].map((e) => [e.accountId, e.value, e.runs, e.eligible, e.rank]).sort());
  return key(a) === key(b);
}

type Publication = { kind: 'gone' } | { kind: 'pending'; pending: number } | { kind: 'moved' } | { kind: 'published'; record: TournamentRow['record']; entrants: string[] };

/**
 * Publishes a tournament's results when it can: in review, its review hours over — or, `force` («Publicar ya»), before
 * them — and nothing holding them. Under the tournament's lock it queues any prize place's run not queued yet and stops
 * if anything holds them, then computes the ranking once more and stops if it moved (a ban or a mark that does not wait
 * for the tournament); only then freezes every live entrant's place, score, runs and rewards from that very ranking,
 * lists the money owed by prize place, sends each winner a mail and finishes the tournament, all in that transaction: a
 * second call publishes nothing. Returns whether it published; forced with something pending, 409 tournament_pending.
 */
export async function finishTournament(deps: TournamentDeps, id: string, opts: { force?: boolean; actor?: AuditActor; reason?: string } = {}): Promise<boolean> {
  const now = deps.now();
  const t = await tournamentById(deps.db, id);
  if (t.state !== 'review') {
    if (opts.force) mustReview(t);
    return false;
  }
  // Read with the pool before any transaction; inside them, only the ranking and the checks (under the lock).
  const rules = await scoringRules(deps, t);
  if (!opts.force && now.getTime() < Date.parse(publishAt(t))) {
    // Not yet: whatever is missing is queued now, so the replays are done by then.
    await ensureChecks(deps.db, t, rules);
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await inTransaction(deps.db, async (trx): Promise<Publication> => {
      const locked = await tournamentById(trx, id, { lock: true });
      if (locked.state !== 'review') return { kind: 'gone' };
      const e = await ensureChecks(trx, locked, rules);
      if (e.blocking > 0) return { kind: 'pending', pending: e.blocking };
      if (!sameRanking(e.ranking, await computeTournamentRanking(trx, scoringOf(locked), rules.season, rules.minRunSeconds))) return { kind: 'moved' };
      const { ranking, places } = e;
      const results = [...ranking.entrants.values()].map((x) => {
        const place = places.get(x.accountId) ?? null;
        return { accountId: x.accountId, username: x.username, rank: x.rank, score: x.value, runs: x.runs, eligible: x.eligible, rewards: tournamentRewardsFor(locked.record, { place, runs: x.runs, eligible: x.eligible }) };
      });
      if (results.length > 0) {
        await sql`
          update galaxy.tournament_entries e
             set final_rank = x.rank, final_score = x.score, final_runs = x.runs, eligible = x.eligible, rewards = x.rewards
            from jsonb_to_recordset(${JSON.stringify(results.map((r) => ({ account_id: r.accountId, rank: r.rank, score: r.score, runs: r.runs, eligible: r.eligible, rewards: r.rewards })))}::jsonb)
                 as x(account_id uuid, rank integer, score bigint, runs integer, eligible boolean, rewards jsonb)
           where e.tournament_id = ${id} and e.account_id = x.account_id`.execute(trx);
      }
      // Money by prize place (among those who can win), the place the prize is for.
      const cash = results.filter((r) => r.rewards?.cash && r.rewards.place !== null);
      if (cash.length > 0) {
        await trx
          .insertInto('galaxy.tournament_cash')
          .values(cash.map((r) => ({ tournament_id: id, account_id: r.accountId, rank: r.rewards!.place!, amount_eur: r.rewards!.cash!.amountEur, note: r.rewards!.cash!.note })))
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
      return { kind: 'published', record: locked.record, entrants: results.map((r) => r.accountId) };
    });
    if (out.kind === 'moved') continue;
    if (out.kind === 'gone') return false;
    if (out.kind === 'pending') {
      if (opts.force) throw new HttpError(409, 'tournament_pending', { pending: out.pending });
      return false;
    }
    invalidateTournament(id);
    deps.live?.sendMany(out.entrants, { type: 'notice', notice: { kind: 'tournament', event: 'finished', id, slug: out.record.slug, title: out.record.title } });
    return true;
  }
  // The ranking kept moving: the next pass tries again.
  if (opts.force) throw new HttpError(409, 'tournament_pending', { pending: 0 });
  return false;
}

// ---------------------------------------------------------------------------------------------------------------------
// The panel's views.

/** The simulation versions of a running or reviewed tournament's runs that count (for the deploy warning). */
async function simVersionsOf(deps: TournamentDeps, t: TournamentRow): Promise<string[]> {
  if (t.state !== 'running' && t.state !== 'review') return [];
  const rules = await scoringRules(deps, t);
  const { rows } = await sql<{ v: string }>`select distinct c.sim_version as v from (${countedRunsSql(scoringOf(t), rules.season, rules.minRunSeconds)}) c order by 1`.execute(deps.db);
  return rows.map((r) => r.v);
}

/** A tournament as the panel lists it, with its counts and whether a deploy changed its simulation. */
export async function adminTournamentOf(deps: TournamentDeps, t: TournamentRow): Promise<AdminTournament> {
  const [counts, checks, cash, names, simVersions] = await Promise.all([
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
    simVersionsOf(deps, t),
  ]);
  const live = t.state === 'running' || t.state === 'review';
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
    simVersion: t.startedSimVersion,
    simChanged: live && t.startedSimVersion !== null && t.startedSimVersion !== SIM_VERSION,
    simVersions,
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

/** Undecided unverifiable checks by reason and by player (`current`: those behind a prize place as it stands). */
export function unverifiableGroups(checks: readonly AdminTournamentCheck[]): UnverifiableGroups {
  const open = checks.filter((c) => c.status === 'unverifiable' && c.decision === null);
  const group = <K extends string>(keyOf: (c: AdminTournamentCheck) => K) => {
    const m = new Map<K, { count: number; blocking: number }>();
    for (const c of open) {
      const g = m.get(keyOf(c)) ?? { count: 0, blocking: 0 };
      g.count++;
      if (c.current) g.blocking++;
      m.set(keyOf(c), g);
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1));
  };
  return {
    byReason: group((c) => (c.detail?.reason ?? 'inputs_missing') as UnverifiableReason).map(([reason, g]) => ({ reason, ...g })),
    byPlayer: group((c) => c.username).map(([username, g]) => ({ username, ...g })),
  };
}

/** GET …/admin/tournaments/:id/review: the ranking with what each would take, the checks, the disqualified, the money. */
export async function reviewView(deps: TournamentDeps, id: string): Promise<AdminTournamentReview> {
  const t = await tournamentById(deps.db, id);
  let ranking: AdminTournamentReview['ranking'] = [];
  let backing: string[] = [];
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
    const b = await prizeBacking(deps.db, t, await scoringRules(deps, t));
    backing = b.runs;
    ranking = b.ranking.rows.map((r) => {
      const place = b.places.get(r.accountId) ?? null;
      return { rank: r.rank!, username: r.username, avatar: r.avatar, frame: r.frame, score: r.value, eligible: r.eligible, place, runs: r.runs, rewards: tournamentRewardsFor(t.record, { place, runs: r.runs, eligible: r.eligible }) };
    });
  }
  const current = new Set(t.state === 'review' ? backing : []);
  const checks = await deps.db
    .selectFrom('galaxy.tournament_checks as k')
    .innerJoin('galaxy.runs as r', 'r.id', 'k.run_id')
    .innerJoin('galaxy.accounts as a', 'a.id', 'r.account_id')
    .select(['k.run_id', 'a.username', 'r.finished_at', 'k.status', 'k.detail', 'k.decision', 'k.decided_by', 'k.decided_at', 'k.checked_at', 'k.attempts'])
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
    attempts: c.attempts,
    current: current.has(c.run_id),
  }));
  // What holds the results: the prize places' checks still to replay or decide, and their runs not queued yet.
  const known = new Set(rows.map((c) => c.runId));
  const blocking = t.state === 'review' ? rows.filter((c) => c.current && holds(c)).length + backing.filter((r) => !known.has(r)).length : 0;
  return {
    tournament: await adminTournamentOf(deps, t),
    ranking,
    checks: rows,
    disqualified: disqualified.map((d) => ({ username: d.username, reason: d.disqualified_reason })),
    publishAt: publishAt(t),
    canPublish: t.state === 'review' && blocking === 0,
    blocking,
    unverifiable: unverifiableGroups(rows),
    cash: await cashPrizes(deps.db, id),
  };
}
