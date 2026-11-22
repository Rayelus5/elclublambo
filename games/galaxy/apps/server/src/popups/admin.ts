import { type AdminPopup, type BigGiftReason, popupBigReasons, type PopupIssue, type PopupRecord, popupRecordSchema, popupState } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { popupById, type PopupRow, recordColumns, recordIssues } from './records';

// Preparing «Encuestas y avisos» (plan 2026-11-22, part A; GDD §16.5): an admin saves drafts (new, or replaced whole at
// the version they read), publishes one (checked again against what is live, with their password; a superadmin when its
// reward is past the mail's limits), takes a published one back to draft before it starts and while nobody saw it, and
// ends one early. Every change is a version and an audit entry in the same transaction.

/** What the campaigns' code needs: the database, the live config and the clock. */
export interface PopupDeps {
  db: Kysely<DB>;
  config: ConfigReader;
  now: () => Date;
}

/** A record that does not hold, as the API answers it (400 with every issue). */
function invalid(issues: PopupIssue[]): never {
  throw new HttpError(400, 'popup_invalid', { issues });
}

/** A new draft (its problems against what is live refuse it; what only publishing needs does not). */
export async function createPopup(deps: PopupDeps, actor: AuditActor, input: unknown, reason: string): Promise<PopupRow> {
  const issues = await recordIssues(deps.db, deps.config, input, deps.now(), false);
  if (issues.length > 0) invalid(issues);
  const p = popupRecordSchema.parse(input);
  return inTransaction(deps.db, async (trx) => {
    const row = await trx
      .insertInto('galaxy.popup_campaigns')
      .values({ ...recordColumns(p), state: 'draft', created_by: actor.id, updated_by: actor.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, { actor, action: 'popup.saved', targetType: 'popup', targetId: row.id, after: p, reason });
    return popupById(trx, row.id);
  });
}

/** A draft replaced whole, at the version the admin read (another admin's save in between is a conflict). */
export async function updatePopup(deps: PopupDeps, actor: AuditActor, id: string, input: unknown, version: number, reason: string): Promise<PopupRow> {
  const issues = await recordIssues(deps.db, deps.config, input, deps.now(), false);
  if (issues.length > 0) invalid(issues);
  const p = popupRecordSchema.parse(input);
  return inTransaction(deps.db, async (trx) => {
    const old = await popupById(trx, id, { lock: true });
    if (old.state !== 'draft') throw new HttpError(409, 'popup_not_draft');
    if (old.version !== version) throw new HttpError(409, 'popup_conflict', { version: old.version });
    await trx
      .updateTable('galaxy.popup_campaigns')
      .set({ ...recordColumns(p), version: old.version + 1, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'popup.saved', targetType: 'popup', targetId: id, before: old.record, after: p, reason });
    return popupById(trx, id);
  });
}

/** Removes a draft (a campaign that was ever seen stays as history). */
export async function deletePopup(deps: PopupDeps, actor: AuditActor, id: string, reason: string): Promise<void> {
  await inTransaction(deps.db, async (trx) => {
    const old = await popupById(trx, id, { lock: true });
    if (old.state !== 'draft') throw new HttpError(409, 'popup_not_draft');
    await trx.deleteFrom('galaxy.popup_campaigns').where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'popup.deleted', targetType: 'popup', targetId: id, before: old.record, reason });
  });
}

/** Why publishing `p` needs a superadmin (empty: any admin), with the live mail limits and cosmetics. */
export async function bigReasonsOf(config: ConfigReader, p: Pick<PopupRecord, 'reward' | 'audience'>): Promise<BigGiftReason[]> {
  const [limits, cosmetics] = await Promise.all([config.get('mailLimits'), config.get('cosmetics')]);
  return popupBigReasons(p, limits, cosmetics);
}

/**
 * A draft is published at the version the admin reviewed: checked again against what is live (its end ahead, a
 * promotion's image, its subjects and gifts), by a superadmin when its reward is big. Players in its audience see it
 * from its start.
 */
export async function publishPopup(deps: PopupDeps, s: SessionInfo, actor: AuditActor, id: string, version: number, reason: string): Promise<PopupRow> {
  const now = deps.now();
  const before = await popupById(deps.db, id);
  if (before.state !== 'draft') throw new HttpError(409, 'popup_not_draft');
  const issues = await recordIssues(deps.db, deps.config, before.record, now, true);
  if (issues.length > 0) invalid(issues);
  const big = await bigReasonsOf(deps.config, before.record);
  if (big.length > 0 && !s.roles.includes('superadmin')) throw new HttpError(403, 'popup_needs_superadmin', { reasons: big });
  return inTransaction(deps.db, async (trx) => {
    const p = await popupById(trx, id, { lock: true });
    if (p.state !== 'draft') throw new HttpError(409, 'popup_not_draft');
    if (p.version !== version || p.version !== before.version) throw new HttpError(409, 'popup_conflict', { version: p.version });
    await trx
      .updateTable('galaxy.popup_campaigns')
      .set({ state: 'published', published_at: now, published_by: actor.id, big: big.length > 0, version: p.version + 1, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, {
      actor,
      action: 'popup.published',
      targetType: 'popup',
      targetId: id,
      after: { kind: p.record.kind, startsAt: p.record.startsAt, endsAt: p.record.endsAt, version: p.version + 1, ...(big.length > 0 ? { big } : {}) },
      reason,
    });
    return popupById(trx, id);
  });
}

/** A published campaign goes back to draft: only before it starts and while nobody saw it (else, end it). */
export async function unpublishPopup(deps: PopupDeps, actor: AuditActor, id: string, reason: string): Promise<PopupRow> {
  return inTransaction(deps.db, async (trx) => {
    const p = await popupById(trx, id, { lock: true });
    // A draft here means someone took it back meanwhile.
    if (p.state === 'draft') throw new HttpError(409, 'popup_conflict', { version: p.version });
    const now = deps.now();
    if (p.endedAt !== null || Date.parse(p.record.endsAt) <= now.getTime()) throw new HttpError(409, 'popup_ended');
    if (Date.parse(p.record.startsAt) <= now.getTime()) throw new HttpError(409, 'popup_started');
    if (await trx.selectFrom('galaxy.popup_views').select('account_id').where('campaign_id', '=', id).limit(1).executeTakeFirst()) throw new HttpError(409, 'popup_started');
    await trx
      .updateTable('galaxy.popup_campaigns')
      .set({ state: 'draft', published_at: null, published_by: null, big: false, version: p.version + 1, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'popup.unpublished', targetType: 'popup', targetId: id, reason });
    return popupById(trx, id);
  });
}

/** A published campaign ends now: nobody sees it again (an answer already shown still has its grace). */
export async function endPopup(deps: PopupDeps, actor: AuditActor, id: string, reason: string): Promise<PopupRow> {
  return inTransaction(deps.db, async (trx) => {
    const p = await popupById(trx, id, { lock: true });
    if (p.state === 'draft') throw new HttpError(409, 'popup_conflict', { version: p.version });
    const now = deps.now();
    if (p.endedAt !== null || Date.parse(p.record.endsAt) <= now.getTime()) throw new HttpError(409, 'popup_ended');
    await trx
      .updateTable('galaxy.popup_campaigns')
      .set({ ended_at: now, ended_by: actor.id, version: p.version + 1, updated_at: sql`now()`, updated_by: actor.id })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, { actor, action: 'popup.ended', targetType: 'popup', targetId: id, before: { state: popupState({ state: p.state, startsAt: p.record.startsAt, endsAt: p.record.endsAt, endedAt: null }, now) }, reason });
    return popupById(trx, id);
  });
}

type Counts = AdminPopup['counts'];

/** What players did with each campaign, for the panel's list: who saw it, answered it and followed «Ver más». */
async function countsOf(db: Kysely<DB>, ids: readonly string[]): Promise<Map<string, Counts>> {
  const out = new Map<string, Counts>(ids.map((id) => [id, { seen: 0, answered: 0, clicked: 0 }]));
  if (ids.length === 0) return out;
  const [views, answers] = await Promise.all([
    db
      .selectFrom('galaxy.popup_views')
      .select(['campaign_id', sql<number>`(count(*) filter (where shows > 0))::int`.as('seen'), sql<number>`(count(*) filter (where clicked_at is not null))::int`.as('clicked')])
      .where('campaign_id', 'in', ids)
      .groupBy('campaign_id')
      .execute(),
    db.selectFrom('galaxy.popup_responses').select(['campaign_id', sql<number>`count(*)::int`.as('answered')]).where('campaign_id', 'in', ids).groupBy('campaign_id').execute(),
  ]);
  for (const v of views) Object.assign(out.get(v.campaign_id)!, { seen: v.seen, clicked: v.clicked });
  for (const a of answers) out.get(a.campaign_id)!.answered = a.answered;
  return out;
}

/** Campaigns as the panel shows them, with their counts and why publishing them needs a superadmin. */
export async function adminPopupsOf(deps: PopupDeps, rows: readonly PopupRow[]): Promise<AdminPopup[]> {
  const now = deps.now();
  const [counts, limits, cosmetics] = await Promise.all([countsOf(deps.db, rows.map((r) => r.id)), deps.config.get('mailLimits'), deps.config.get('cosmetics')]);
  return rows.map((r) => ({
    id: r.id,
    state: popupState({ state: r.state, startsAt: r.record.startsAt, endsAt: r.record.endsAt, endedAt: r.endedAt }, now),
    version: r.version,
    record: r.record,
    createdAt: r.createdAt,
    createdBy: r.createdBy,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    publishedAt: r.publishedAt,
    publishedBy: r.publishedBy,
    endedAt: r.endedAt,
    endedBy: r.endedBy,
    counts: counts.get(r.id)!,
    bigReasons: popupBigReasons(r.record, limits, cosmetics),
  }));
}

/** One campaign as the panel shows it. */
export async function adminPopupOf(deps: PopupDeps, row: PopupRow): Promise<AdminPopup> {
  return (await adminPopupsOf(deps, [row]))[0]!;
}
