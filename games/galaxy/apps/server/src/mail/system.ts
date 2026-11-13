import { MAIL_GIFTS, type MailGifts } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import type { Notices } from '../realtime/notices';

// A message the game itself sends to one player (plan «referidos»; like the shop's after-sale notes): no admin behind
// it, its gifts claimed in the mailbox like any other. Its date is the database's: a message reaches the accounts that
// existed when it was sent, and one sent in the transaction that creates the account must reach that account.

/** Only the gifts worth something (a zero is not a gift). */
export function cleanGifts(g: MailGifts): MailGifts {
  const out: MailGifts = {};
  for (const k of MAIL_GIFTS) if ((g[k] ?? 0) > 0) out[k] = g[k];
  return out;
}

export async function sendSystemMail(
  trx: Kysely<DB>,
  account: { id: string; username: string },
  mail: { title: string; body: string; gifts?: MailGifts },
  out?: Notices,
): Promise<string> {
  const m = await trx
    .insertInto('galaxy.mailbox_messages')
    .values({
      title: mail.title,
      body: mail.body,
      gifts: JSON.stringify(cleanGifts(mail.gifts ?? {})),
      audience: JSON.stringify({ kind: 'segment', usernames: [account.username.toLowerCase()] }),
      created_by: null,
      created_at: sql<Date>`now()`,
      expires_at: sql<Date>`now() + interval '30 days'`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx.insertInto('galaxy.mailbox_receipts').values({ message_id: m.id, account_id: account.id }).execute();
  out?.add(account.id, { kind: 'mail', id: m.id, title: mail.title });
  return m.id;
}
