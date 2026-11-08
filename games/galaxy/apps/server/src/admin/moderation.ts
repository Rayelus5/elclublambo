import { MOD_PAGE_SIZE, MOD_REPORTS_PAGE_SIZE, type ModChannel, type ModMessage, type ModMute, type ModOutcome, type ModReport, type ModReportPage } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import { type ChatDeps, asChannel, hideAudited, lockMessage, muteAudited, pendingReports, recordReview } from '../chat/service';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { guardTarget } from './players';

// Chat moderation (GDD §16.4; M6c-1), for staff signed in with TOTP: every chat live (the global one and each clan's,
// hidden messages included), hiding and restoring, the report queue and the mutes. Every change is audited in its own
// transaction. A moderator's decision on a message (hide, restore or a queue outcome) also closes its pending reports,
// so only reports after it count toward hiding it again.

const iso = (d: Date | string) => new Date(d).toISOString();

/** The global chat first, then the clans with messages in the last 30 days, the busiest lately first (50 at most). */
export async function modChannels(db: Kysely<DB>): Promise<ModChannel[]> {
  const g = await db.selectFrom('galaxy.chat_messages').select(sql<Date | null>`max(created_at)`.as('at')).where('channel', '=', 'global').executeTakeFirst();
  const clans = await sql<{ id: string; tag: string; name: string; last_at: Date }>`
    select c.id, c.tag, c.name, max(m.created_at) as last_at
    from galaxy.chat_messages m join galaxy.clans c on m.channel = 'clan:' || c.id::text
    where m.created_at > now() - interval '30 days'
    group by c.id order by last_at desc limit 50`.execute(db);
  return [
    { key: 'global', label: 'Comunidad', lastAt: g?.at ? iso(g.at) : null },
    ...clans.rows.map((c) => ({ key: `clan:${c.id}`, label: `[${c.tag}] ${c.name}`, lastAt: iso(c.last_at) })),
  ];
}

function messageRows(db: Kysely<DB>) {
  return db
    .selectFrom('galaxy.chat_messages as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.author_id')
    .leftJoin('galaxy.accounts as h', 'h.id', 'm.hidden_by')
    .select((eb) => [
      'm.id',
      'm.channel',
      'm.body',
      'm.created_at',
      'm.hidden_at',
      'm.hidden_reason',
      'a.username as author',
      'h.username as hidden_by',
      eb.selectFrom('galaxy.chat_reports as r').select(sql<number>`count(*)::int`.as('n')).whereRef('r.message_id', '=', 'm.id').as('reports'),
    ]);
}
type MessageRow = Awaited<ReturnType<ReturnType<typeof messageRows>['execute']>>[number];

const toMessage = (r: MessageRow): ModMessage => ({
  id: String(r.id),
  channel: r.channel,
  author: r.author,
  body: r.body,
  at: iso(r.created_at),
  hidden: r.hidden_at ? { reason: r.hidden_reason as 'moderator' | 'reports', by: r.hidden_by ?? null, at: iso(r.hidden_at) } : null,
  reports: Number(r.reports ?? 0),
});

/** A chat's messages, newest first, hidden ones included; `before` pages back. */
export async function modMessages(db: Kysely<DB>, channel: string, before: string | undefined): Promise<ModMessage[]> {
  let q = messageRows(db).where('m.channel', '=', channel);
  if (before) q = q.where('m.id', '<', before);
  return (await q.orderBy('m.id', 'desc').limit(MOD_PAGE_SIZE).execute()).map(toMessage);
}

/** Restores a hidden message (it shows on the next history load; nothing is pushed), audited. 409 if it is visible. */
export async function modRestore(deps: ChatDeps, actor: AuditActor, id: string, reason: string): Promise<{ hidden: false }> {
  await inTransaction(deps.db, async (trx) => {
    const m = await lockMessage(trx, id);
    if (!m.hidden_at) throw new HttpError(409, 'message_visible');
    const by = m.hidden_by ? await trx.selectFrom('galaxy.accounts').select('username').where('id', '=', m.hidden_by).executeTakeFirst() : undefined;
    await trx.updateTable('galaxy.chat_messages').set({ hidden_at: null, hidden_reason: null, hidden_by: null }).where('id', '=', id).execute();
    if ((await pendingReports(trx, id)) > 0) await recordReview(trx, id, 'kept', actor, reason);
    await writeAudit(trx, { actor, action: 'chat.restore', targetType: 'chat_message', targetId: id, before: { reason: m.hidden_reason, by: by?.username ?? null }, reason });
  });
  return { hidden: false };
}

export async function modHide(deps: ChatDeps, actor: AuditActor, id: string, reason: string): Promise<{ hidden: true }> {
  await hideAudited(deps, actor, id, reason);
  return { hidden: true };
}

/**
 * The queue: messages with reports since their last review, the one reported most recently first (a message reported
 * again rises to the top), 50 a page, with how many are waiting.
 */
export async function modReports(db: Kysely<DB>, page: number): Promise<ModReportPage> {
  const pending = sql`
    select r.message_id, count(*)::int as pending, min(r.created_at) as first_at, max(r.created_at) as last_at,
      (array_remove(array_agg(r.reason order by r.created_at desc), null))[1:5] as reasons
    from galaxy.chat_reports r left join galaxy.chat_report_reviews v on v.message_id = r.message_id
    where v.reviewed_at is null or r.created_at > v.reviewed_at
    group by r.message_id`;
  const { rows: counted } = await sql<{ n: number }>`select count(*)::int as n from (${pending}) p`.execute(db);
  const total = counted[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / MOD_REPORTS_PAGE_SIZE));
  const { rows } = await sql<{ message_id: string; pending: number; first_at: Date; last_at: Date; reasons: string[] | null }>`
    select * from (${pending}) p order by last_at desc, message_id desc
    limit ${MOD_REPORTS_PAGE_SIZE} offset ${(page - 1) * MOD_REPORTS_PAGE_SIZE}`.execute(db);
  if (rows.length === 0) return { reports: [], total, page, pages };
  const messages = await messageRows(db)
    .where(
      'm.id',
      'in',
      rows.map((p) => String(p.message_id)),
    )
    .execute();
  const byId = new Map(messages.map((r) => [String(r.id), toMessage(r)]));
  const reports: ModReport[] = rows.flatMap((p) => {
    const message = byId.get(String(p.message_id));
    return message ? [{ message, reasons: p.reasons ?? [], pending: p.pending, firstAt: iso(p.first_at), lastAt: iso(p.last_at) }] : [];
  });
  return { reports, total, page, pages };
}

/**
 * A moderator's decision on a reported message: hide it, or keep it visible (restoring it if reports hid it). The
 * message is locked first, so of two moderators deciding at once the second finds nothing pending (409).
 */
export async function resolveReport(deps: ChatDeps, actor: AuditActor, id: string, outcome: ModOutcome, reason: string): Promise<{ outcome: ModOutcome }> {
  const hid = await inTransaction(deps.db, async (trx) => {
    const m = await lockMessage(trx, id);
    const pending = await pendingReports(trx, id);
    if (pending === 0) throw new HttpError(409, 'report_reviewed');
    const hide = outcome === 'hidden' && !m.hidden_at;
    if (hide) await trx.updateTable('galaxy.chat_messages').set({ hidden_at: deps.now(), hidden_reason: 'moderator', hidden_by: actor.id }).where('id', '=', id).execute();
    if (outcome === 'kept' && m.hidden_at) await trx.updateTable('galaxy.chat_messages').set({ hidden_at: null, hidden_reason: null, hidden_by: null }).where('id', '=', id).execute();
    await recordReview(trx, id, outcome, actor, reason);
    await writeAudit(trx, { actor, action: 'chat.review', targetType: 'chat_message', targetId: id, before: { hidden: m.hidden_reason, pending }, after: { outcome }, reason });
    return hide ? m.channel : null;
  });
  if (hid) await deps.hub.broadcast(hid, { type: 'deleted', channel: asChannel(hid), id });
  return { outcome };
}

/** The mutes still running, the soonest to end first. */
export async function modMutes(db: Kysely<DB>, now: Date): Promise<ModMute[]> {
  const rows = await db
    .selectFrom('galaxy.chat_mutes as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.account_id')
    .leftJoin('galaxy.accounts as b', 'b.id', 'm.by_id')
    .select(['a.username', 'm.until', 'm.reason', 'b.username as by'])
    .where('m.until', '>', now)
    .orderBy('m.until')
    .limit(200)
    .execute();
  return rows.map((r) => ({ username: r.username, until: iso(r.until), reason: r.reason, by: r.by ?? null }));
}

export function modMute(deps: ChatDeps, actor: AuditActor, s: SessionInfo, req: { username: string; minutes: number; reason: string }): Promise<{ until: string }> {
  return muteAudited(deps, actor, s, req);
}

/** Ends a running mute now (the row stays, with its end moved to now), audited. 404 when the account is not muted. */
export async function modUnmute(deps: ChatDeps, actor: AuditActor, s: SessionInfo, username: string, reason: string): Promise<{ lifted: true }> {
  const target = await guardTarget(deps.db, s, username, { self: false });
  await inTransaction(deps.db, async (trx) => {
    const m = await trx.selectFrom('galaxy.chat_mutes').select(['until', 'reason']).where('account_id', '=', target.id).forUpdate().executeTakeFirst();
    if (!m || new Date(m.until) <= deps.now()) throw new HttpError(404, 'mute_not_found');
    await trx.updateTable('galaxy.chat_mutes').set({ until: deps.now() }).where('account_id', '=', target.id).execute();
    await writeAudit(trx, { actor, action: 'chat.unmute', targetType: 'account', targetId: target.id, before: { until: iso(m.until), reason: m.reason }, reason });
  });
  return { lifted: true };
}
