import { type ChatChannel, type ChatHistory, type ChatMessage, cleanBody, levelOf, maskWords } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { guardTarget } from '../admin/players';
import { type AuditActor, writeAudit } from '../audit';
import { isStaff } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { accountXp } from '../social/progress';
import type { ChatHub } from './hub';

// The chats (GDD §14.4; M5b-2): the global channel and each clan's. Writing needs the account level (`chat.minLevel`),
// no mute and the per-minute limit; the message is cleaned and the live word filter covers its words; the hub pushes
// it. Reports from enough different accounts hide a message; moderators (moderator, admin or superadmin, signed in
// with TOTP) hide messages and mute accounts, audited (M6c-1). Messages are hidden, never deleted. Only the reports
// after a message's last review count: a message a moderator kept visible needs new reports to be hidden again.

/** `roomOf`: the id of the room an account is in (rooms live in the server's memory); without it there is no room chat. */
export type ChatDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date; hub: ChatHub; roomOf?: (accountId: string) => string | null };

/** Staff signed in with TOTP moderate the chats (the panel's rule, `isStaff`). */
export const isModerator = isStaff;

/**
 * The channel's key in the table: 'global', 'clan:<id>' of the viewer's clan (403 when they have none), or 'room:<id>'
 * of the room they are in (404 when they are in none: the room chat is only for its members, while they are).
 */
async function channelKey(deps: Pick<ChatDeps, 'db' | 'roomOf'>, accountId: string, channel: ChatChannel): Promise<string> {
  if (channel === 'global') return 'global';
  if (channel === 'room') {
    const room = deps.roomOf?.(accountId) ?? null;
    if (!room) throw new HttpError(404, 'room_not_found');
    return `room:${room}`;
  }
  const m = await deps.db.selectFrom('galaxy.clan_members').select('clan_id').where('account_id', '=', accountId).executeTakeFirst();
  if (!m) throw new HttpError(403, 'clan_forbidden');
  return `clan:${m.clan_id}`;
}

export const asChannel = (key: string): ChatChannel => (key === 'global' ? 'global' : key.startsWith('room:') ? 'room' : 'clan');

async function messagesWhere(db: Kysely<DB>, key: string, opts: { before?: string; id?: string; limit: number }, levels: (xp: number) => number): Promise<ChatMessage[]> {
  let q = db
    .selectFrom('galaxy.chat_messages as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.author_id')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'm.author_id')
    .leftJoin('galaxy.clan_members as cm', 'cm.account_id', 'm.author_id')
    .leftJoin('galaxy.clans as c', 'c.id', 'cm.clan_id')
    .select(['m.id', 'm.channel', 'm.body', 'm.created_at', 'a.username', 'a.avatar', 'a.frame', 'x.xp', 'c.tag'])
    .where('m.channel', '=', key)
    .where('m.hidden_at', 'is', null);
  if (opts.before) q = q.where('m.id', '<', opts.before);
  if (opts.id) q = q.where('m.id', '=', opts.id);
  const rows = await q.orderBy('m.id', 'desc').limit(opts.limit).execute();
  return rows.reverse().map((r) => ({
    id: String(r.id),
    channel: asChannel(r.channel),
    author: { username: r.username, level: levels(Number(r.xp ?? 0)), clan: r.tag ?? null, avatar: r.avatar, frame: r.frame },
    body: r.body,
    at: new Date(r.created_at).toISOString(),
  }));
}

async function muteOf(db: Kysely<DB>, accountId: string, now: Date): Promise<Date | null> {
  const m = await db.selectFrom('galaxy.chat_mutes').select('until').where('account_id', '=', accountId).executeTakeFirst();
  return m && new Date(m.until) > now ? new Date(m.until) : null;
}

export async function chatHistory(deps: ChatDeps, s: SessionInfo, channel: ChatChannel, before: string | undefined): Promise<ChatHistory> {
  const [chat, account] = await Promise.all([deps.config.get('chat'), deps.config.get('account')]);
  const key = await channelKey(deps, s.accountId, channel);
  const levels = (xp: number) => levelOf(xp, account).level;
  const messages = await messagesWhere(deps.db, key, { before, limit: chat.history }, levels);
  const level = levels(await accountXp(deps.db, s.accountId));
  const muted = await muteOf(deps.db, s.accountId, deps.now());
  // Moderators write whatever their level (a new staff account is level 1).
  const reason = level < chat.minLevel && !isModerator(s) ? 'level' : muted ? 'muted' : null;
  return {
    channel,
    messages,
    canWrite: reason === null,
    reason,
    ...(muted ? { mutedUntil: muted.toISOString() } : {}),
    minLevel: chat.minLevel,
    maxLength: chat.maxLength,
    moderator: isModerator(s),
  };
}

export async function sendMessage(deps: ChatDeps, s: SessionInfo, channel: ChatChannel, raw: string): Promise<ChatMessage> {
  const [chat, account] = await Promise.all([deps.config.get('chat'), deps.config.get('account')]);
  const key = await channelKey(deps, s.accountId, channel);
  if (!isModerator(s) && levelOf(await accountXp(deps.db, s.accountId), account).level < chat.minLevel) throw new HttpError(403, 'chat_level');
  if (await muteOf(deps.db, s.accountId, deps.now())) throw new HttpError(403, 'chat_muted');
  const body = cleanBody(raw, chat.maxLength);
  if (body === null) throw new HttpError(400, 'chat_empty');
  await hitRateLimit(deps.db, `a:${s.accountId}`, 'chat', chat.perMinute, 60);
  const row = await deps.db
    .insertInto('galaxy.chat_messages')
    .values({ channel: key, author_id: s.accountId, body: maskWords(body, chat.words) })
    .returning('id')
    .executeTakeFirstOrThrow();
  const [message] = await messagesWhere(deps.db, key, { id: String(row.id), limit: 1 }, (xp) => levelOf(xp, account).level);
  await deps.hub.broadcast(key, { type: 'message', message: message! });
  return message!;
}

/** A message that can still be seen, and its channel's key; 404 when hidden or gone. */
async function visibleMessage(db: Kysely<DB>, id: string): Promise<{ channel: string; author_id: string }> {
  const m = await db.selectFrom('galaxy.chat_messages').select(['channel', 'author_id']).where('id', '=', id).where('hidden_at', 'is', null).executeTakeFirst();
  if (!m) throw new HttpError(404, 'message_not_found');
  return m;
}

async function hide(deps: ChatDeps, id: string, channel: string, reason: 'moderator' | 'reports', by: string | null): Promise<void> {
  const done = await deps.db
    .updateTable('galaxy.chat_messages')
    .set({ hidden_at: deps.now(), hidden_reason: reason, hidden_by: by })
    .where('id', '=', id)
    .where('hidden_at', 'is', null)
    .executeTakeFirst();
  if (Number(done.numUpdatedRows) > 0) await deps.hub.broadcast(channel, { type: 'deleted', channel: asChannel(channel), id });
}

/** The reports on a message since its last review (all of them when it was never reviewed). */
export async function pendingReports(db: Kysely<DB>, id: string): Promise<number> {
  const { n } = await db
    .selectFrom('galaxy.chat_reports as r')
    .leftJoin('galaxy.chat_report_reviews as v', 'v.message_id', 'r.message_id')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('r.message_id', '=', id)
    .where((eb) => eb.or([eb('v.reviewed_at', 'is', null), eb('r.created_at', '>', eb.ref('v.reviewed_at'))]))
    .executeTakeFirstOrThrow();
  return n;
}

/** Records a moderator's decision on a message's pending reports (its last review; the database's clock, as reports). */
export async function recordReview(trx: Kysely<DB>, id: string, outcome: 'hidden' | 'kept', actor: AuditActor, reason: string): Promise<void> {
  const values = { outcome, by_id: actor.id, reason, reviewed_at: sql<Date>`now()` };
  await trx
    .insertInto('galaxy.chat_report_reviews')
    .values({ message_id: id, ...values })
    .onConflict((oc) => oc.column('message_id').doUpdateSet(values))
    .execute();
}

/** A message, locked for a moderator's change; 404 when there is none. */
export async function lockMessage(trx: Kysely<DB>, id: string) {
  const m = await trx.selectFrom('galaxy.chat_messages').select(['channel', 'body', 'hidden_at', 'hidden_reason', 'hidden_by']).where('id', '=', id).forUpdate().executeTakeFirst();
  if (!m) throw new HttpError(404, 'message_not_found');
  return m;
}

/**
 * A moderator hides a message: audited in the same transaction, its pending reports resolved as hidden, and the
 * sockets drop it once committed. 409 when it already is hidden.
 */
export async function hideAudited(deps: ChatDeps, actor: AuditActor, id: string, reason: string): Promise<void> {
  const channel = await inTransaction(deps.db, async (trx) => {
    const m = await lockMessage(trx, id);
    if (m.hidden_at) throw new HttpError(409, 'message_hidden');
    await trx.updateTable('galaxy.chat_messages').set({ hidden_at: deps.now(), hidden_reason: 'moderator', hidden_by: actor.id }).where('id', '=', id).execute();
    if ((await pendingReports(trx, id)) > 0) await recordReview(trx, id, 'hidden', actor, reason);
    await writeAudit(trx, { actor, action: 'chat.hide', targetType: 'chat_message', targetId: id, before: { body: m.body }, reason });
    return m.channel;
  });
  await deps.hub.broadcast(channel, { type: 'deleted', channel: asChannel(channel), id });
}

/** Mutes an account (a moderator may not mute staff they cannot act on, nor themselves), audited. */
export async function muteAudited(deps: ChatDeps, actor: AuditActor, s: SessionInfo, req: { username: string; minutes: number; reason: string }): Promise<{ until: string }> {
  const target = await guardTarget(deps.db, s, req.username, { self: false });
  const until = new Date(deps.now().getTime() + req.minutes * 60_000);
  await inTransaction(deps.db, async (trx) => {
    const before = await trx.selectFrom('galaxy.chat_mutes').select(['until', 'reason']).where('account_id', '=', target.id).forUpdate().executeTakeFirst();
    const active = before && new Date(before.until) > deps.now() ? { until: new Date(before.until).toISOString(), reason: before.reason } : undefined;
    await trx
      .insertInto('galaxy.chat_mutes')
      .values({ account_id: target.id, until, reason: req.reason, by_id: actor.id })
      .onConflict((oc) => oc.column('account_id').doUpdateSet({ until, reason: req.reason, by_id: actor.id, created_at: deps.now() }))
      .execute();
    await writeAudit(trx, { actor, action: 'chat.mute', targetType: 'account', targetId: target.id, before: active, after: { until: until.toISOString(), minutes: req.minutes }, reason: req.reason });
  });
  return { until: until.toISOString() };
}

/**
 * A report: one per account and message, never the author's own, and only from accounts with the level that writing
 * needs (or moderators), so throwaway accounts cannot take messages down; at `chat.hideAfter` reports it hides.
 */
export async function reportMessage(deps: ChatDeps, s: SessionInfo, id: string, reason: string | undefined): Promise<{ hidden: boolean }> {
  const [chat, account] = await Promise.all([deps.config.get('chat'), deps.config.get('account')]);
  const m = await visibleMessage(deps.db, id);
  // A clan's or a room's message can only be reported by who can read it.
  if (m.channel !== 'global' && (await channelKey(deps, s.accountId, asChannel(m.channel)).catch(() => null)) !== m.channel) throw new HttpError(404, 'message_not_found');
  if (m.author_id === s.accountId) return { hidden: false };
  if (!isModerator(s) && levelOf(await accountXp(deps.db, s.accountId), account).level < chat.minLevel) return { hidden: false };
  await deps.db
    .insertInto('galaxy.chat_reports')
    .values({ message_id: id, reporter_id: s.accountId, reason: reason?.trim() || null })
    .onConflict((oc) => oc.columns(['message_id', 'reporter_id']).doNothing())
    .execute();
  if ((await pendingReports(deps.db, id)) < chat.hideAfter) return { hidden: false };
  await hide(deps, id, m.channel, 'reports', null);
  return { hidden: true };
}

/** The in-game hide (a moderator in the chat itself): audited with a fixed reason. */
export async function hideMessage(deps: ChatDeps, s: SessionInfo, actor: AuditActor, id: string): Promise<{ hidden: true }> {
  if (!isModerator(s)) throw new HttpError(403, 'forbidden');
  await visibleMessage(deps.db, id);
  await hideAudited(deps, actor, id, 'Ocultado desde el chat');
  return { hidden: true };
}

export async function muteAccount(deps: ChatDeps, s: SessionInfo, actor: AuditActor, req: { username: string; minutes: number; reason: string }): Promise<{ until: string }> {
  if (!isModerator(s)) throw new HttpError(403, 'forbidden');
  return muteAudited(deps, actor, s, req);
}
