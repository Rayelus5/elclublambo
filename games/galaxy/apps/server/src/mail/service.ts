import { inAudience, levelOf, MAIL_GIFTS, type MailAudience, type MailGifts, type MailMessage, type MyMailbox, type TitleNotice, type Wallet } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { credit, getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { accountXp } from '../social/progress';

// The mailbox and the title notices for players (GDD §16.5; M6d-1). A message is live while it is not withdrawn and
// not expired; it reaches an account that existed when it was sent and matches its audience. Reading marks a receipt;
// claiming its gift sets the receipt's claimed_at once (the primary key and a guarded update make it once, also from
// two tabs at once) and credits each gift as a `mail_gift` ledger entry, in one transaction.

export type MailDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date };

const MAILBOX_SIZE = 100;
const iso = (d: Date | string) => new Date(d).toISOString();

type Facts = { level: number; createdAt: Date; username: string };

async function factsOf(deps: MailDeps, accountId: string): Promise<Facts> {
  const a = await deps.db.selectFrom('galaxy.accounts').select(['username', 'created_at']).where('id', '=', accountId).executeTakeFirstOrThrow();
  const level = levelOf(await accountXp(deps.db, accountId), await deps.config.get('account')).level;
  return { level, createdAt: new Date(a.created_at), username: a.username };
}

/** The live messages that reach an account, newest first, with its receipts. */
async function liveFor(deps: MailDeps, accountId: string, onlyId?: string) {
  const facts = await factsOf(deps, accountId);
  let q = deps.db
    .selectFrom('galaxy.mailbox_messages as m')
    .leftJoin('galaxy.mailbox_receipts as r', (j) => j.onRef('r.message_id', '=', 'm.id').on('r.account_id', '=', accountId))
    .select(['m.id', 'm.title', 'm.body', 'm.gifts', 'm.audience', 'm.created_at', 'm.expires_at', 'r.read_at', 'r.claimed_at'])
    .where('m.withdrawn_at', 'is', null)
    .where('m.expires_at', '>', deps.now())
    .where('m.created_at', '>=', facts.createdAt);
  if (onlyId) q = q.where('m.id', '=', onlyId);
  const rows = await q.orderBy('m.created_at', 'desc').limit(MAILBOX_SIZE).execute();
  return rows.filter((r) => inAudience(r.audience as MailAudience, facts, new Date(r.created_at)));
}

const toMessage = (r: Awaited<ReturnType<typeof liveFor>>[number]): MailMessage => ({
  id: r.id,
  title: r.title,
  body: r.body,
  gifts: r.gifts as MailGifts,
  at: iso(r.created_at),
  expiresAt: iso(r.expires_at),
  read: r.read_at !== null,
  claimed: r.claimed_at !== null,
});

export async function myMailbox(deps: MailDeps, accountId: string): Promise<MyMailbox> {
  const messages = (await liveFor(deps, accountId)).map(toMessage);
  return { messages, unread: messages.filter((m) => !m.read).length };
}

/** 404 mail_gone for a message that is not live for this account (withdrawn, expired, or not theirs). */
async function liveMessage(deps: MailDeps, accountId: string, id: string) {
  const [m] = await liveFor(deps, accountId, id);
  if (!m) throw new HttpError(404, 'mail_gone');
  return m;
}

export async function readMail(deps: MailDeps, accountId: string, id: string): Promise<{ read: true }> {
  await liveMessage(deps, accountId, id);
  await deps.db
    .insertInto('galaxy.mailbox_receipts')
    .values({ message_id: id, account_id: accountId, read_at: deps.now() })
    .onConflict((oc) => oc.columns(['message_id', 'account_id']).doUpdateSet({ read_at: sql<Date>`coalesce(galaxy.mailbox_receipts.read_at, excluded.read_at)` }))
    .execute();
  return { read: true };
}

/** Claims a message's gift once: 409 mail_claimed the second time; a message without gifts has nothing to claim. */
export async function claimMail(deps: MailDeps, accountId: string, id: string): Promise<{ wallet: Wallet }> {
  const m = await liveMessage(deps, accountId, id);
  const gifts = m.gifts as MailGifts;
  return inTransaction(deps.db, async (trx) => {
    const now = deps.now();
    const done = await trx
      .insertInto('galaxy.mailbox_receipts')
      .values({ message_id: id, account_id: accountId, read_at: now, claimed_at: now })
      .onConflict((oc) =>
        oc
          .columns(['message_id', 'account_id'])
          .doUpdateSet({ claimed_at: now, read_at: sql<Date>`coalesce(galaxy.mailbox_receipts.read_at, excluded.read_at)` })
          .where('galaxy.mailbox_receipts.claimed_at', 'is', null),
      )
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
