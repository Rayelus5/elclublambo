import type { Kysely } from 'kysely';
import { rolesOf } from '../auth/sessions';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// Who may collect a gift an admin gave (M6a's rule for whom the panel touches; the mail since M6d-1, the rewards of
// «Encuestas y avisos» since 2026-11-22): nobody collects their own gift, staff collect only a superadmin's, and a
// superadmin none.

/** Why an account may not collect a gift given by `senderId` (`self`, `staff`), or null when it may. */
export async function giftBlock(db: Kysely<DB>, accountId: string, senderId: string | null): Promise<'self' | 'staff' | null> {
  if (senderId === accountId) return 'self';
  const mine = await rolesOf(db, accountId);
  if (mine.length === 0) return null;
  const sender = senderId ? await rolesOf(db, senderId) : [];
  return mine.includes('superadmin') || !sender.includes('superadmin') ? 'staff' : null;
}

/** The mailbox's guard: 403 `self_target` or `staff_target` when the account may not collect it. */
export async function guardGift(db: Kysely<DB>, accountId: string, senderId: string | null): Promise<void> {
  const block = await giftBlock(db, accountId, senderId);
  if (block) throw new HttpError(403, block === 'self' ? 'self_target' : 'staff_target');
}
