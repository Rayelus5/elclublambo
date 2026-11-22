import { type LiveEvent, tournamentBigReasons, type TournamentFee, type TournamentRecord, tournamentRecordSchema } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { credit } from '../economy/wallet';
import { HttpError } from '../errors';
import { recordColumns, recordIssues, tournamentById, type TournamentRow } from './records';
import { invalidateTournament } from './scoring';

// Preparing tournaments (plan «temporadas como fichas», part 5; GDD §13.3): an admin saves drafts (new, or replaced whole
// at the version they read), schedules one (checked again against what is live, with their password; a superadmin when
// its prizes are past the mail's limits or carry money), takes a scheduled one back before it starts and while nobody
// is in it, and cancels one (every fee back, once). Every change is a version and an audit entry.

/** What the tournaments' code needs: the database, the live config, the clock and (for notices) the live hub. */
export interface TournamentDeps {
  db: Kysely<DB>;
  config: ConfigReader;
  now: () => Date;
  live?: { send(id: string, event: LiveEvent): void; sendMany(ids: Iterable<string>, event: LiveEvent): void; onlineIds?(): Iterable<string> };
}

/** A record that does not hold, as the API answers it (400 with every issue). */
function invalid(issues: { path: string; message: string }[]): never {
  throw new HttpError(400, 'tournament_invalid', { issues });
}

/** A unique slug taken between the check and the write (two admins at once). */
function slugError(err: unknown): never {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23505') throw new HttpError(409, 'tournament_slug_taken');
  throw err;
}

/** What a draft must hold (a draft's season may still be a draft; its end may not have passed). */
async function draftIssues(deps: TournamentDeps, input: unknown, self: string | null) {
  return (await recordIssues(deps.db, deps.config, input, deps.now(), self)).filter((i) => i.message !== 'tournament_season_closed');
}

/** A new draft. */
export async function createTournament(deps: TournamentDeps, actor: AuditActor, input: unknown, reason: string): Promise<TournamentRow> {
  const issues = await draftIssues(deps, input, null);
  if (issues.length > 0) invalid(issues);
  const t = tournamentRecordSchema.parse(input);
  return inTransaction(deps.db, async (trx) => {
    const row = await trx
      .insertInto('galaxy.tournaments')
      .values({ ...recordColumns(t), state: 'draft', created_by: actor.id, updated_by: actor.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, { actor, action: 'tournament.saved', targetType: 'tournament', targetId: row.id, after: t, reason });
    return tournamentById(trx, row.id);
  }).catch(slugError);
}

/** A draft replaced whole, at the version the admin read (another admin's save in between is a conflict). */
export async function updateTournament(deps: TournamentDeps, actor: AuditActor, id: string, input: unknown, version: number, reason: string): Promise<TournamentRow> {
  const issues = await draftIssues(deps, input, id);
  if (issues.length > 0) invalid(issues);
  const t = tournamentRecordSchema.parse(input);
  return inTransaction(deps.db, async (trx) => {
    const old = await tournamentById(trx, id, { lock: true });
    if (old.state !== 'draft') throw new HttpError(409, 'tournament_not_draft');
    if (old.version !== version) throw new HttpError(409, 'tournament_conflict', { version: old.version });
    await trx
      .updateTable('galaxy.tournaments')
      .set({ ...recordColumns(t), version: old.version + 1, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'tournament.saved', targetType: 'tournament', targetId: id, before: old.record, after: t, reason });
    return tournamentById(trx, id);
  }).catch(slugError);
}

/** Removes a draft (a tournament that was ever scheduled stays as history). */
export async function deleteTournament(deps: TournamentDeps, actor: AuditActor, id: string, reason: string): Promise<void> {
  await inTransaction(deps.db, async (trx) => {
    const old = await tournamentById(trx, id, { lock: true });
    if (old.state !== 'draft') throw new HttpError(409, 'tournament_not_draft');
    await trx.deleteFrom('galaxy.tournaments').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'tournament.deleted', targetType: 'tournament', targetId: id, before: old.record, reason });
  });
}

/** Why scheduling `t` needs a superadmin (empty: any admin), with the live mail limits and cosmetics. */
export async function bigReasonsOf(config: ConfigReader, t: TournamentRecord) {
  const [limits, cosmetics] = await Promise.all([config.get('mailLimits'), config.get('cosmetics')]);
  return tournamentBigReasons(t, limits, cosmetics);
}

/**
 * A draft becomes scheduled: players see it and can sign up, and it starts on its own. Checked again against what is
 * live (its season scheduled and around it, its end still ahead, its gifts possible), at the version the admin reviewed.
 */
export async function scheduleTournament(deps: TournamentDeps, s: SessionInfo, actor: AuditActor, id: string, version: number, reason: string): Promise<TournamentRow> {
  const now = deps.now();
  const before = await tournamentById(deps.db, id);
  const issues = await recordIssues(deps.db, deps.config, before.record, now, id);
  if (Date.parse(before.record.endsAt) <= now.getTime()) issues.push({ path: 'endsAt', message: 'tournament_end_past' });
  if (issues.length > 0) invalid(issues);
  const big = await bigReasonsOf(deps.config, before.record);
  if (big.length > 0 && !s.roles.includes('superadmin')) throw new HttpError(403, 'tournament_needs_superadmin', { reasons: big });
  return inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state !== 'draft') throw new HttpError(409, 'tournament_not_draft');
    if (t.version !== version || t.version !== before.version) throw new HttpError(409, 'tournament_conflict', { version: t.version });
    await trx
      .updateTable('galaxy.tournaments')
      .set({ state: 'scheduled', version: t.version + 1, scheduled_at: now, scheduled_by: actor.id, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'tournament.scheduled', targetType: 'tournament', targetId: id, after: { startsAt: t.record.startsAt, endsAt: t.record.endsAt, version: t.version + 1, ...(big.length > 0 ? { big } : {}) }, reason });
    return tournamentById(trx, id);
  });
}

/** A scheduled tournament goes back to draft: only before it starts and while nobody is in it (else, cancel it). */
export async function unscheduleTournament(deps: TournamentDeps, actor: AuditActor, id: string, reason: string): Promise<TournamentRow> {
  return inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state !== 'scheduled') throw new HttpError(409, t.state === 'draft' ? 'tournament_draft' : 'tournament_started');
    if (Date.parse(t.record.startsAt) <= deps.now().getTime()) throw new HttpError(409, 'tournament_started');
    if (await trx.selectFrom('galaxy.tournament_entries').select('account_id').where('tournament_id', '=', id).limit(1).executeTakeFirst()) throw new HttpError(409, 'tournament_has_entrants');
    await trx
      .updateTable('galaxy.tournaments')
      .set({ state: 'draft', version: t.version + 1, scheduled_at: null, scheduled_by: null, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'tournament.unscheduled', targetType: 'tournament', targetId: id, reason });
    return tournamentById(trx, id);
  });
}

/**
 * Cancels a tournament that is scheduled, running or in review: nothing is published and every fee comes back — to who
 * left too (the tournament did not happen), not to who was disqualified. Each refund once (`refunded_at`), in the same
 * transaction; its entrants hear it after.
 */
export async function cancelTournament(deps: TournamentDeps, actor: AuditActor, id: string, reason: string): Promise<{ tournament: TournamentRow; refunded: number }> {
  const now = deps.now();
  const out = await inTransaction(deps.db, async (trx) => {
    const t = await tournamentById(trx, id, { lock: true });
    if (t.state === 'draft') throw new HttpError(409, 'tournament_draft');
    if (t.state === 'finished' || t.state === 'cancelled') throw new HttpError(409, 'tournament_finished');
    const owed = await trx
      .updateTable('galaxy.tournament_entries')
      .set({ refunded_at: now })
      .where('tournament_id', '=', id)
      .where('refunded_at', 'is', null)
      .where('fee', 'is not', null)
      .where('disqualified', '=', false)
      .returning(['account_id', 'fee'])
      .execute();
    for (const e of owed) {
      const fee = e.fee as TournamentFee;
      await credit(trx, e.account_id, fee.currency, fee.amount, 'tournament_refund', { tournament: id }, `tournament:${id}:refund`);
    }
    await trx
      .updateTable('galaxy.tournaments')
      .set({ state: 'cancelled', cancelled_at: now, version: t.version + 1, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'tournament.cancelled', targetType: 'tournament', targetId: id, before: { state: t.state }, after: { refunded: owed.length }, reason });
    const entrants = await trx.selectFrom('galaxy.tournament_entries').select('account_id').where('tournament_id', '=', id).where('left_at', 'is', null).execute();
    return { tournament: await tournamentById(trx, id), refunded: owed.length, entrants: entrants.map((e) => e.account_id) };
  });
  invalidateTournament(id);
  const r = out.tournament.record;
  deps.live?.sendMany(out.entrants, { type: 'notice', notice: { kind: 'tournament', event: 'cancelled', id, slug: r.slug, title: r.title } });
  return { tournament: out.tournament, refunded: out.refunded };
}
