import { eventCurrencyAlive, type GachaConfig, type LeftoverView } from '@galaxy/shared';
import type { Kysely } from 'kysely';
import type { DB } from '../db/schema';
import { credit, debit } from '../economy/wallet';

// Event signals left over (open beta): once no scanner pays with them any more and their event is over, what a player
// still holds becomes star dust (`leftoverDust` each), the next time they come back. Both movements go to the ledger
// under `event_leftover`, and a row remembers it so the player is told once. The balances are read FOR UPDATE, so
// two visits at once convert them only once.

const REASON = 'event_leftover';
/** An event's id as words, when neither the event nor its scanner is in the config any more: «primer-contacto» → «Primer contacto». */
const readable = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');

export async function convertLeftovers(
  trx: Kysely<DB>,
  accountId: string,
  cfg: GachaConfig,
  events: readonly { id: string; name: string; endsAt: string }[],
  now: Date,
): Promise<void> {
  const held = await trx
    .selectFrom('galaxy.balances')
    .select(['currency', 'amount'])
    .where('account_id', '=', accountId)
    .where('currency', 'like', 'signal:%')
    .where('amount', '>', '0')
    .forUpdate()
    .execute();
  for (const row of held) {
    if (eventCurrencyAlive(row.currency, cfg.banners, events, now)) continue;
    const signals = Number(row.amount);
    const dust = signals * cfg.leftoverDust;
    const id = row.currency.slice('signal:'.length);
    const label = events.find((e) => e.id === id)?.name ?? cfg.banners.find((b) => b.currency === row.currency)?.name ?? readable(id);
    const ref = { currency: row.currency, signals, rate: cfg.leftoverDust };
    await debit(trx, accountId, row.currency, signals, REASON, ref);
    if (dust > 0) await credit(trx, accountId, 'dust', dust, REASON, ref);
    await trx.insertInto('galaxy.event_leftovers').values({ account_id: accountId, currency: row.currency, label, signals, dust }).execute();
  }
}

/** The conversions this player has not seen yet, oldest first. */
export async function unseenLeftovers(db: Kysely<DB>, accountId: string): Promise<LeftoverView[]> {
  const rows = await db
    .selectFrom('galaxy.event_leftovers')
    .select(['id', 'label', 'signals', 'dust'])
    .where('account_id', '=', accountId)
    .where('seen_at', 'is', null)
    .orderBy('id')
    .execute();
  return rows.map((r) => ({ id: String(r.id), label: r.label, signals: Number(r.signals), dust: Number(r.dust) }));
}

/** Marks this player's conversions as seen (anyone else's ids are ignored). */
export async function markLeftoversSeen(db: Kysely<DB>, accountId: string, ids: string[], now: Date): Promise<void> {
  await db.updateTable('galaxy.event_leftovers').set({ seen_at: now }).where('account_id', '=', accountId).where('id', 'in', ids).where('seen_at', 'is', null).execute();
}
