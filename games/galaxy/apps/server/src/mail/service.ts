import { expiringSoon, type GrantedItem, hasAnyGift, legacyView, type MailMessage, type MyMailbox, readContents, seasonOpen, type TitleNotice, type Wallet } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { rolesOf } from '../auth/sessions';
import type { ConfigReader } from '../config/reader';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { getWallet } from '../economy/wallet';
import { HttpError } from '../errors';
import { grantGifts } from '../gifts/grant';
import { invalidateLeaderboard } from '../social/leaderboard';

// The mailbox and the title notices for players (GDD §16.5; M6d-1). Who a message reaches is fixed when it is sent:
// one receipt per recipient (M6d-1 review), so levelling up or renaming later neither takes a message away nor hands
// one out, and the gifts minted are the ones the admin approved. A message is live while it is not withdrawn and not
// expired. Reading stamps the receipt; claiming stamps it once (a guarded update under the message's shared lock, so a
// withdrawal and a claim never cross) and gives every gift in one transaction (mail v2: `grantGifts`, gifts of every
// kind; currencies keyed `mail:<id>:<currency>` as before). Nobody collects a gift they sent themselves, and staff only
// collect a superadmin's (M6a's rule for whom the panel touches). Mail v2: the player archives and deletes (never a
// message whose gift is still to claim), claims everything at once, and pages through the inbox or the archive.

export type MailDeps = { db: Kysely<DB>; config: ConfigReader; now: () => Date };

const iso = (d: Date | string) => new Date(d).toISOString();
const CLAIM_ALL = 50;

/** An account's live messages it has not deleted. */
function liveFor(deps: MailDeps, accountId: string) {
  return deps.db
    .selectFrom('galaxy.mailbox_receipts as r')
    .innerJoin('galaxy.mailbox_messages as m', 'm.id', 'r.message_id')
    .select(['m.id', 'm.title', 'm.body', 'm.type', 'm.gifts', 'm.created_at', 'm.expires_at', 'r.read_at', 'r.claimed_at', 'r.archived_at', 'r.granted'])
    .where('r.account_id', '=', accountId)
    .where('r.deleted_at', 'is', null)
    .where('m.withdrawn_at', 'is', null)
    .where('m.expires_at', '>', deps.now());
}

/** A page's cursor: the last message's date and id (the list goes newest first). */
const cursorOf = (at: Date | string, id: string) => `${iso(at)}|${id}`;
function parseCursor(cursor: string): { at: Date; id: string } {
  const [at, id] = cursor.split('|');
  const d = new Date(at ?? '');
  if (!id || Number.isNaN(d.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'invalid_input');
  return { at: d, id };
}

export async function myMailbox(deps: MailDeps, accountId: string, q: { box?: 'inbox' | 'archive'; type?: string; cursor?: string; limit?: number } = {}): Promise<MyMailbox> {
  const now = deps.now();
  const limit = q.limit ?? 100;
  let page = liveFor(deps, accountId).where('r.archived_at', q.box === 'archive' ? 'is not' : 'is', null);
  if (q.type) page = page.where('m.type', '=', q.type as never);
  if (q.cursor) {
    const c = parseCursor(q.cursor);
    page = page.where((eb) => eb.or([eb('m.created_at', '<', c.at), eb.and([eb('m.created_at', '=', c.at), eb('m.id', '<', c.id)])]));
  }
  const [rows, all, library] = await Promise.all([
    page.orderBy('m.created_at', 'desc').orderBy('m.id', 'desc').limit(limit + 1).execute(),
    // The counts are the whole mailbox's (inbox and archive), not this page's.
    liveFor(deps, accountId).execute(),
    deps.config.get('mail'),
  ]);
  const more = rows.length > limit;
  const shown = rows.slice(0, limit);
  const messages: MailMessage[] = shown.map((r) => {
    const { contents } = readContents(r.gifts);
    const claimed = r.claimed_at !== null;
    const expiresAt = iso(r.expires_at);
    return {
      id: r.id,
      title: r.title,
      body: r.body,
      type: r.type,
      contents,
      granted: (r.granted as GrantedItem[] | null) ?? null,
      gifts: legacyView(contents),
      at: iso(r.created_at),
      expiresAt,
      // «Caduca pronto» only means something for a gift still to claim.
      warn: !claimed && hasAnyGift(contents) && expiringSoon(expiresAt, now, library.warnDays),
      read: r.read_at !== null,
      claimed,
      archived: r.archived_at !== null,
    };
  });
  const last = shown[shown.length - 1];
  return {
    messages,
    unread: all.filter((r) => r.read_at === null).length,
    unclaimed: all.filter((r) => r.claimed_at === null && hasAnyGift(readContents(r.gifts).contents)).length,
    next: more && last ? cursorOf(last.created_at, last.id) : null,
  };
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
export async function claimMail(deps: MailDeps, accountId: string, id: string): Promise<{ wallet: Wallet; granted: GrantedItem[] }> {
  const season = await deps.config.get('season');
  let seasonTouched = false;
  const out = await inTransaction(deps.db, async (trx) => {
    const now = deps.now();
    // Shared with other claims, exclusive with a withdrawal (FOR UPDATE there): they never cross.
    const m = await trx.selectFrom('galaxy.mailbox_messages').select(['gifts', 'created_by']).where('id', '=', id).where('withdrawn_at', 'is', null).where('expires_at', '>', now).forShare().executeTakeFirst();
    const mine = m
      ? await trx.selectFrom('galaxy.mailbox_receipts').select('claimed_at').where('message_id', '=', id).where('account_id', '=', accountId).where('deleted_at', 'is', null).executeTakeFirst()
      : undefined;
    if (!m || !mine) throw new HttpError(404, 'mail_gone');
    const { contents } = readContents(m.gifts);
    const gifts = [...contents.items, ...contents.packs.flatMap((p) => p.items)];
    if (gifts.length > 0) await guardGift(trx, accountId, m.created_by);
    const done = await trx
      .updateTable('galaxy.mailbox_receipts')
      .set({ claimed_at: now, read_at: sql<Date>`coalesce(read_at, ${now})` })
      .where('message_id', '=', id)
      .where('account_id', '=', accountId)
      .where('claimed_at', 'is', null)
      .returning('message_id')
      .executeTakeFirst();
    if (!done) throw new HttpError(409, 'mail_claimed');
    const given = await grantGifts(trx, accountId, gifts, {
      key: `mail:${id}`,
      // Each player's own galaxies (the same claim always makes the same ones).
      seedKey: `mail:${id}:${accountId}`,
      reason: 'mail_gift',
      ref: { message: id },
      actor: { id: accountId, label: 'buzón' },
      season: { id: season.id, open: seasonOpen(season, now) },
      auditAction: 'mail.claim',
    });
    seasonTouched = given.seasonTouched;
    await trx.updateTable('galaxy.mailbox_receipts').set({ granted: JSON.stringify(given.items) }).where('message_id', '=', id).where('account_id', '=', accountId).execute();
    return { wallet: await getWallet(trx, accountId), granted: given.items };
  });
  if (seasonTouched) invalidateLeaderboard();
  return out;
}

/** Claims every live gift still to claim (the oldest first, up to 50), each in its own transaction. */
export async function claimAllMail(deps: MailDeps, accountId: string): Promise<{ claimed: number; granted: { id: string; items: GrantedItem[] }[]; wallet: Wallet }> {
  const rows = await liveFor(deps, accountId).where('r.claimed_at', 'is', null).orderBy('m.created_at', 'asc').execute();
  const due = rows.filter((r) => hasAnyGift(readContents(r.gifts).contents)).slice(0, CLAIM_ALL);
  const granted: { id: string; items: GrantedItem[] }[] = [];
  for (const r of due) {
    try {
      granted.push({ id: r.id, items: (await claimMail(deps, accountId, r.id)).granted });
    } catch (e) {
      // Claimed in another tab, withdrawn meanwhile or not this account's to collect: the rest still go.
      if (!(e instanceof HttpError)) throw e;
    }
  }
  return { claimed: granted.length, granted, wallet: await getWallet(deps.db, accountId) };
}

/** Puts a message away in the archive, or back in the inbox. */
export async function archiveMail(deps: MailDeps, accountId: string, id: string, archived: boolean): Promise<{ archived: boolean }> {
  const live = await liveFor(deps, accountId).where('m.id', '=', id).executeTakeFirst();
  if (!live) throw new HttpError(404, 'mail_gone');
  await deps.db
    .updateTable('galaxy.mailbox_receipts')
    .set({ archived_at: archived ? deps.now() : null })
    .where('message_id', '=', id)
    .where('account_id', '=', accountId)
    .execute();
  return { archived };
}

/** Deletes a message from the mailbox: never one whose gift is still to claim (409 mail_has_gift). */
export async function deleteMail(deps: MailDeps, accountId: string, id: string): Promise<{ deleted: true }> {
  const live = await liveFor(deps, accountId).where('m.id', '=', id).executeTakeFirst();
  if (!live) throw new HttpError(404, 'mail_gone');
  if (live.claimed_at === null && hasAnyGift(readContents(live.gifts).contents)) throw new HttpError(409, 'mail_has_gift');
  await deps.db.updateTable('galaxy.mailbox_receipts').set({ deleted_at: deps.now() }).where('message_id', '=', id).where('account_id', '=', accountId).execute();
  return { deleted: true };
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
