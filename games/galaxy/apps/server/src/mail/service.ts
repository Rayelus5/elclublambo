import { hasGifts, MAIL_GIFTS, type MailGifts, type MailMessage, type MyMailbox, type TitleNotice, type Wallet } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { rolesOf } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { credit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';

// The mailbox and the title notices for players (GDD §16.5; M6d-1). Who a message reaches is fixed when it is sent:
// one receipt per recipient (M6d-1 review), so levelling up or renaming later neither takes a message away nor hands
// one out, and the gifts minted are the ones the admin approved. A message is live while it is not withdrawn and not
// expired. Reading stamps the receipt; claiming stamps it once (a guarded update under the message's shared lock, so a
// withdrawal and a claim never cross) and credits each gift as a `mail_gift` ledger entry, in one transaction. Nobody
// collects a gift they sent themselves, and staff only collect a superadmin's (M6a's rule for whom the panel touches).

export type MailDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date };

const MAILBOX_SIZE = 100;
const iso = (d: Date | string) => new Date(d).toISOString();

/** An account's live messages, newest first, from its receipts. */
function liveFor(deps: MailDeps, accountId: string) {
  return deps.db
    .selectFrom('galaxy.mailbox_receipts as r')
    .innerJoin('galaxy.mailbox_messages as m', 'm.id', 'r.message_id')
    .select(['m.id', 'm.title', 'm.body', 'm.gifts', 'm.created_at', 'm.expires_at', 'r.read_at', 'r.claimed_at'])
    .where('r.account_id', '=', accountId)
    .where('m.withdrawn_at', 'is', null)
    .where('m.expires_at', '>', deps.now());
}

export async function myMailbox(deps: MailDeps, accountId: string): Promise<MyMailbox> {
  const rows = await liveFor(deps, accountId).orderBy('m.created_at', 'desc').limit(MAILBOX_SIZE).execute();
  const messages: MailMessage[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    gifts: r.gifts as MailGifts,
    at: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    read: r.read_at !== null,
    claimed: r.claimed_at !== null,
  }));
  return { messages, unread: messages.filter((m) => !m.read).length };
}

export async function readMail(deps: MailDeps, accountId: string, id: string): Promise<{ read: true }> {
  const live = await liveFor(deps, accountId).where('m.id', '=', id).executeTakeFirst();
  if (!live) throw new HttpError(404, 'mail_gone');
  await deps.db
    .updateTable('galaxy.mailbox_receipts')
    .set({ read_at: sql<Date>`coalesce(read_at, ${deps.now()})` })
    .where('message_id', '=', id)
    .where('account_id', '=', accountId)
    .execute();
  return { read: true };
}

/** Claims a message's gift once: 409 mail_claimed the second time; 404 mail_gone when it is not live for this account. */
export async function claimMail(deps: MailDeps, accountId: string, id: string): Promise<{ wallet: Wallet }> {
  return inTransaction(deps.db, async (trx) => {
    const now = deps.now();
    // Shared with other claims, exclusive with a withdrawal (FOR UPDATE there): they never cross.
    const m = await trx.selectFrom('galaxy.mailbox_messages').select(['gifts', 'created_by']).where('id', '=', id).where('withdrawn_at', 'is', null).where('expires_at', '>', now).forShare().executeTakeFirst();
    const mine = m ? await trx.selectFrom('galaxy.mailbox_receipts').select('claimed_at').where('message_id', '=', id).where('account_id', '=', accountId).executeTakeFirst() : undefined;
    if (!m || !mine) throw new HttpError(404, 'mail_gone');
    const gifts = m.gifts as MailGifts;
    if (hasGifts(gifts)) await guardGift(trx, accountId, m.created_by);
    const done = await trx
      .updateTable('galaxy.mailbox_receipts')
      .set({ claimed_at: now, read_at: sql<Date>`coalesce(read_at, ${now})` })
      .where('message_id', '=', id)
      .where('account_id', '=', accountId)
      .where('claimed_at', 'is', null)
      .returning('message_id')
      .executeTakeFirst();
    if (!done) throw new HttpError(409, 'mail_claimed');
    for (const k of MAIL_GIFTS) {
      const amount = gifts[k] ?? 0;
      if (amount > 0) await credit(trx, accountId, k, amount, 'mail_gift', { message: id }, `mail:${id}:${k}`);
    }
    return { wallet: await getWallet(trx, accountId) };
  });
}

/** No gifts to oneself; staff collect only a superadmin's, and a superadmin none (the panel's rule, M6a). */
async function guardGift(db: Kysely<DB>, accountId: string, senderId: string | null): Promise<void> {
  if (senderId === accountId) throw new HttpError(403, 'self_target');
  const mine = await rolesOf(db, accountId);
  if (mine.length === 0) return;
  const sender = senderId ? await rolesOf(db, senderId) : [];
  if (mine.includes('superadmin') || !sender.includes('superadmin')) throw new HttpError(403, 'staff_target');
}

/** The notices running now, the newest first, three at most. */
export async function liveNotices(db: Kysely<DB>, now: Date): Promise<TitleNotice[]> {
  const rows = await db
    .selectFrom('galaxy.title_notices')
    .select(['id', 'text', 'tone'])
    .where('ended_at', 'is', null)
    .where('starts_at', '<=', now)
    .where('ends_at', '>', now)
    .orderBy('starts_at', 'desc')
    .limit(3)
    .execute();
  return rows.map((r) => ({ id: r.id, text: r.text, tone: r.tone }));
}
