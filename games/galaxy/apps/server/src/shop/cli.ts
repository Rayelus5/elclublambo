import type { Kysely } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import { createConfigService } from '../config/service';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import type { ShopGateway } from './gateway';
import { applySession } from './service';

// The resource shop from the container's CLI (shop and lab plan, F4): `shop-reconcile` asks Stripe about every recent
// payment that is not delivered (a webhook that never came), and `shop-unblock` opens a blocked account's shop again.

/** Checks the payments of the last `days` days that Stripe may have taken without telling us; returns what changed. */
export async function reconcileShop(db: Kysely<DB>, gateway: ShopGateway, days: number, now: Date = new Date()): Promise<{ checked: number; delivered: number; expired: number; failed: number }> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await db
    .selectFrom('galaxy.shop_purchases')
    .select(['id', 'status', 'stripe_session_id'])
    .where('created_at', '>=', since)
    .where('status', 'in', ['creating', 'pending', 'expired'])
    .where('stripe_session_id', 'is not', null)
    .orderBy('created_at')
    .execute();
  const deps = { db, config: createConfigService(db), now: () => new Date(), gateway, origins: [] };
  let delivered = 0;
  let expired = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await applySession(deps, r.id, await gateway.retrieveCheckoutSession(r.stripe_session_id!));
    } catch {
      failed++;
      continue;
    }
    const after = (await db.selectFrom('galaxy.shop_purchases').select('status').where('id', '=', r.id).executeTakeFirstOrThrow()).status;
    if (after === 'paid' && r.status !== 'paid') delivered++;
    else if (after === 'expired' && r.status !== 'expired') expired++;
  }
  return { checked: rows.length, delivered, expired, failed };
}

/** Opens an account's shop again; false when it was not blocked. */
export async function unblockShop(db: Kysely<DB>, actor: AuditActor, accountId: string, reason: string): Promise<boolean> {
  return inTransaction(db, async (trx) => {
    const gone = await trx.deleteFrom('galaxy.shop_blocks').where('account_id', '=', accountId).returning('account_id').executeTakeFirst();
    if (!gone) return false;
    await writeAudit(trx, { actor, action: 'shop.unblock', targetType: 'account', targetId: accountId, reason });
    return true;
  });
}
