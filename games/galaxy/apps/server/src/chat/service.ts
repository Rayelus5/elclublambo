import { type ChatChannel, type ChatHistory, type ChatMessage, cleanBody, levelOf, maskWords } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { isStaff } from '../auth/guards';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';
import { hitRateLimit } from '../ratelimit';
import { accountXp } from '../social/progress';
import type { ChatHub } from './hub';

// The chats (GDD §14.4; M5b-2): the global channel and each clan's. Writing needs the account level (`chat.minLevel`),
// no mute and the per-minute limit; the message is cleaned and the live word filter covers its words; the hub pushes
// it. Reports from enough different accounts hide a message; moderators (moderator, admin or superadmin, signed in
// with TOTP) hide messages and mute accounts. Messages are hidden, never deleted.

export type ChatDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date; hub: ChatHub };

/** Staff signed in with TOTP moderate the chats (the panel's rule, `isStaff`). */
export const isModerator = isStaff;

/** The channel's key in the table: 'global', or 'clan:<id>' of the viewer's clan (403 when they have none). */
async function channelKey(db: Kysely<DB>, accountId: string, channel: ChatChannel): Promise<string> {
  if (channel === 'global') return 'global';
  const m = await db.selectFrom('galaxy.clan_members').select('clan_id').where('account_id', '=', accountId).executeTakeFirst();
  if (!m) throw new HttpError(403, 'clan_forbidden');
  return `clan:${m.clan_id}`;
}

const asChannel = (key: string): ChatChannel => (key === 'global' ? 'global' : 'clan');

async function messagesWhere(db: Kysely<DB>, key: string, opts: { before?: string; id?: string; limit: number }, levels: (xp: number) => number): Promise<ChatMessage[]> {
  let q = db
    .selectFrom('galaxy.chat_messages as m')
    .innerJoin('galaxy.accounts as a', 'a.id', 'm.author_id')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'm.author_id')
    .leftJoin('galaxy.clan_members as cm', 'cm.account_id', 'm.author_id')
    .leftJoin('galaxy.clans as c', 'c.id', 'cm.clan_id')
    .select(['m.id', 'm.channel', 'm.body', 'm.created_at', 'a.username', 'x.xp', 'c.tag'])
    .where('m.channel', '=', key)
    .where('m.hidden_at', 'is', null);
  if (opts.before) q = q.where('m.id', '<', opts.before);
  if (opts.id) q = q.where('m.id', '=', opts.id);
  const rows = await q.orderBy('m.id', 'desc').limit(opts.limit).execute();
  return rows.reverse().map((r) => ({
    id: String(r.id),
    channel: asChannel(r.channel),
    author: { username: r.username, level: levels(Number(r.xp ?? 0)), clan: r.tag ?? null },
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
  const key = await channelKey(deps.db, s.accountId, channel);
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
  const key = await channelKey(deps.db, s.accountId, channel);
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

/**
 * A report: one per account and message, never the author's own, and only from accounts with the level that writing
 * needs (or moderators), so throwaway accounts cannot take messages down; at `chat.hideAfter` reports it hides.
 */
export async function reportMessage(deps: ChatDeps, s: SessionInfo, id: string, reason: string | undefined): Promise<{ hidden: boolean }> {
  const [chat, account] = await Promise.all([deps.config.get('chat'), deps.config.get('account')]);
  const m = await visibleMessage(deps.db, id);
  // A clan's message can only be reported by who can read it.
  if (m.channel !== 'global' && (await channelKey(deps.db, s.accountId, 'clan')) !== m.channel) throw new HttpError(404, 'message_not_found');
  if (m.author_id === s.accountId) return { hidden: false };
  if (!isModerator(s) && levelOf(await accountXp(deps.db, s.accountId), account).level < chat.minLevel) return { hidden: false };
  await deps.db
    .insertInto('galaxy.chat_reports')
    .values({ message_id: id, reporter_id: s.accountId, reason: reason?.trim() || null })
    .onConflict((oc) => oc.columns(['message_id', 'reporter_id']).doNothing())
    .execute();
  const { n } = await deps.db.selectFrom('galaxy.chat_reports').select(sql<number>`count(*)::int`.as('n')).where('message_id', '=', id).executeTakeFirstOrThrow();
  if (n < chat.hideAfter) return { hidden: false };
  await hide(deps, id, m.channel, 'reports', null);
  return { hidden: true };
}

export async function hideMessage(deps: ChatDeps, s: SessionInfo, id: string): Promise<{ hidden: true }> {
  if (!isModerator(s)) throw new HttpError(403, 'forbidden');
  const m = await visibleMessage(deps.db, id);
  await hide(deps, id, m.channel, 'moderator', s.accountId);
  return { hidden: true };
}

export async function muteAccount(deps: ChatDeps, s: SessionInfo, req: { username: string; minutes: number; reason: string }): Promise<{ until: string }> {
  if (!isModerator(s)) throw new HttpError(403, 'forbidden');
  const target = await deps.db.selectFrom('galaxy.accounts').select('id').where('username', '=', req.username).executeTakeFirst();
  if (!target) throw new HttpError(404, 'profile_not_found');
  const until = new Date(deps.now().getTime() + req.minutes * 60_000);
  await deps.db
    .insertInto('galaxy.chat_mutes')
    .values({ account_id: target.id, until, reason: req.reason, by_id: s.accountId })
    .onConflict((oc) => oc.column('account_id').doUpdateSet({ until, reason: req.reason, by_id: s.accountId }))
    .execute();
  return { until: until.toISOString() };
}
