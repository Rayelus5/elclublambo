import { type AdminMailRow, type AdminMailSend, type AdminNoticeRow, hasGifts, inAudience, levelOf, type MailAudience, type MailGifts } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { SessionInfo } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { HttpError } from '../errors';
import type { LiveBroadcast } from '../realtime/notices';
import { confirmPassword } from './players';

// Communication for admins (GDD §16.5; M6d-1): sending news with gifts to everyone or a segment (with the password when
// it gives anything, since that creates currency), withdrawing it, and the notices of the title screen. The audience is
// evaluated once, when the message is sent (with `inAudience`, over the accounts that exist then; the beta has few), and
// fixed as one receipt per recipient: what the preview and the audit say is what reaches the mailboxes.

/** `live`: the live hub, so a new mail reaches who is connected at once (real-time notices plan); none in the CLI. */
export type CommunicationDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date; live?: LiveBroadcast };

const iso = (d: Date | string) => new Date(d).toISOString();

type Account = { id: string; level: number; createdAt: Date; username: string };

async function accounts(deps: CommunicationDeps): Promise<Account[]> {
  const cfg = await deps.config.get('account');
  const rows = await deps.db
    .selectFrom('galaxy.accounts as a')
    .leftJoin('galaxy.account_xp as x', 'x.account_id', 'a.id')
    .select(['a.id', 'a.username', 'a.created_at', 'x.xp'])
    .execute();
  return rows.map((r) => ({ id: r.id, username: r.username, createdAt: new Date(r.created_at), level: levelOf(Number(r.xp ?? 0), cfg).level }));
}

const reached = (all: Account[], audience: MailAudience, at: Date) => all.filter((a) => inAudience(audience, a, at));

export async function previewMail(deps: CommunicationDeps, audience: MailAudience): Promise<{ recipients: number }> {
  return { recipients: reached(await accounts(deps), audience, deps.now()).length };
}

/** Sends a message (the password first when it gives anything), audited with how many it reaches. */
export async function sendMail(deps: CommunicationDeps, actor: AuditActor, s: SessionInfo, req: AdminMailSend): Promise<{ id: string; recipients: number }> {
  if (hasGifts(req.gifts)) {
    if (!req.password) throw new HttpError(400, 'invalid_input');
    await confirmPassword(deps.db, s, req.password);
  }
  const now = deps.now();
  const to = reached(await accounts(deps), req.audience, now);
  const recipients = to.length;
  const expiresAt = new Date(now.getTime() + req.expiresInDays * 86_400_000);
  const sent = await inTransaction(deps.db, async (trx) => {
    const row = await trx
      .insertInto('galaxy.mailbox_messages')
      .values({ title: req.title, body: req.body, gifts: JSON.stringify(req.gifts), audience: JSON.stringify(req.audience), created_by: actor.id, created_at: now, expires_at: expiresAt })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (let i = 0; i < to.length; i += 1000) {
      await trx
        .insertInto('galaxy.mailbox_receipts')
        .values(to.slice(i, i + 1000).map((a) => ({ message_id: row.id, account_id: a.id })))
        .execute();
    }
    await writeAudit(trx, {
      actor,
      action: 'mail.send',
      targetType: 'mail',
      targetId: row.id,
      after: { title: req.title, gifts: req.gifts, audience: req.audience, expiresAt: iso(expiresAt), recipients },
      reason: req.reason,
    });
    return { id: row.id, recipients };
  });
  // Saved: every recipient connected now hears of it.
  deps.live?.sendMany(
    to.map((a) => a.id),
    { type: 'notice', notice: { kind: 'mail', id: sent.id, title: req.title } },
  );
  return sent;
}

/** Withdraws a live message: it leaves every mailbox and its gift can no longer be claimed. */
export async function withdrawMail(deps: CommunicationDeps, actor: AuditActor, id: string, reason: string): Promise<{ withdrawn: true }> {
  return inTransaction(deps.db, async (trx) => {
    const m = await trx.selectFrom('galaxy.mailbox_messages').select(['title', 'withdrawn_at', 'expires_at']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!m || m.withdrawn_at || new Date(m.expires_at) <= deps.now()) throw new HttpError(409, 'mail_gone');
    await trx.updateTable('galaxy.mailbox_messages').set({ withdrawn_at: deps.now() }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'mail.withdraw', targetType: 'mail', targetId: id, before: { title: m.title }, reason });
    return { withdrawn: true };
  });
}

/** The latest 50 messages with how many they reached (their receipts), read and claimed. */
export async function adminMail(deps: CommunicationDeps): Promise<AdminMailRow[]> {
  const rows = await deps.db
    .selectFrom('galaxy.mailbox_messages as m')
    .leftJoin('galaxy.accounts as b', 'b.id', 'm.created_by')
    .select((eb) => [
      'm.id',
      'm.title',
      'm.body',
      'm.gifts',
      'm.audience',
      'm.created_at',
      'm.expires_at',
      'm.withdrawn_at',
      'b.username as by',
      eb.selectFrom('galaxy.mailbox_receipts as r').select(eb.fn.countAll<number>().as('n')).whereRef('r.message_id', '=', 'm.id').as('recipients'),
      eb.selectFrom('galaxy.mailbox_receipts as r').select(eb.fn.countAll<number>().as('n')).whereRef('r.message_id', '=', 'm.id').where('r.read_at', 'is not', null).as('read'),
      eb.selectFrom('galaxy.mailbox_receipts as r').select(eb.fn.countAll<number>().as('n')).whereRef('r.message_id', '=', 'm.id').where('r.claimed_at', 'is not', null).as('claimed'),
    ])
    .orderBy('m.created_at', 'desc')
    .limit(50)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    gifts: r.gifts as MailGifts,
    audience: r.audience as MailAudience,
    by: r.by ?? null,
    at: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    withdrawnAt: r.withdrawn_at ? iso(r.withdrawn_at) : null,
    recipients: Number(r.recipients ?? 0),
    read: Number(r.read ?? 0),
    claimed: Number(r.claimed ?? 0),
  }));
}

export async function adminNotices(deps: CommunicationDeps): Promise<AdminNoticeRow[]> {
  const now = deps.now();
  const rows = await deps.db
    .selectFrom('galaxy.title_notices as n')
    .leftJoin('galaxy.accounts as b', 'b.id', 'n.created_by')
    .select(['n.id', 'n.text', 'n.tone', 'n.starts_at', 'n.ends_at', 'n.ended_at', 'b.username as by'])
    .orderBy('n.created_at', 'desc')
    .limit(50)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    tone: r.tone,
    startsAt: iso(r.starts_at),
    endsAt: iso(r.ends_at),
    endedAt: r.ended_at ? iso(r.ended_at) : null,
    by: r.by ?? null,
    live: !r.ended_at && new Date(r.starts_at) <= now && new Date(r.ends_at) > now,
  }));
}

export async function createNotice(deps: CommunicationDeps, actor: AuditActor, req: { text: string; tone: 'info' | 'warning'; startsAt: string; endsAt: string; reason: string }): Promise<{ id: string }> {
  return inTransaction(deps.db, async (trx) => {
    const row = await trx
      .insertInto('galaxy.title_notices')
      .values({ text: req.text, tone: req.tone, starts_at: req.startsAt, ends_at: req.endsAt, created_by: actor.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await writeAudit(trx, { actor, action: 'notice.create', targetType: 'notice', targetId: row.id, after: { text: req.text, tone: req.tone, startsAt: req.startsAt, endsAt: req.endsAt }, reason: req.reason });
    return { id: row.id };
  });
}

/** Ends a notice now (or before it starts). 409 notice_gone when it already ended. */
export async function endNotice(deps: CommunicationDeps, actor: AuditActor, id: string, reason: string): Promise<{ ended: true }> {
  return inTransaction(deps.db, async (trx) => {
    const n = await trx.selectFrom('galaxy.title_notices').select(['text', 'ends_at', 'ended_at']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!n || n.ended_at || new Date(n.ends_at) <= deps.now()) throw new HttpError(409, 'notice_gone');
    await trx.updateTable('galaxy.title_notices').set({ ended_at: deps.now() }).where('id', '=', id).execute();
    await writeAudit(trx, { actor, action: 'notice.end', targetType: 'notice', targetId: id, before: { text: n.text }, reason });
    return { ended: true };
  });
}
