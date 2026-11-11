import type { Currency, Wallet } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import type { DB } from '../db/schema';
import { HttpError } from '../errors';

// The wallet (GDD §11.3): balances per currency over an append-only ledger. Credits and debits run inside the
// caller's transaction, so a pull's payment and its galaxies commit or roll back together. A debit is one
// conditional UPDATE (amount ≥ n), which row-locks and never lets two concurrent debits overdraw.

export async function getWallet(db: Kysely<DB>, accountId: string): Promise<Wallet> {
  // A season's currency (M7d-1) is shown on the season screen, never in the wallet.
  const rows = await db.selectFrom('galaxy.balances').select(['currency', 'amount']).where('account_id', '=', accountId).where('currency', 'not like', 'season:%').execute();
  const wallet: Wallet = { coins: 0, dust: 0, signal: 0 };
  for (const r of rows) wallet[r.currency] = Number(r.amount);
  return wallet;
}

async function record(
  trx: Kysely<DB>,
  accountId: string,
  currency: Currency | string,
  delta: number,
  balance: number,
  reason: string,
  ref: unknown,
  opKey: string | null,
): Promise<void> {
  await trx
    .insertInto('galaxy.ledger')
    .values({
      account_id: accountId,
      currency,
      delta,
      balance_after: balance,
      reason,
      ref: JSON.stringify(ref ?? {}),
      operation_key: opKey,
    })
    .execute();
}

/** Adds `amount` (> 0); returns the new balance. */
export async function credit(
  trx: Kysely<DB>,
  accountId: string,
  currency: Currency | string,
  amount: number,
  reason: string,
  ref: unknown = {},
  opKey: string | null = null,
): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError(`credit amount must be a positive integer: ${amount}`);
  const row = await trx
    .insertInto('galaxy.balances')
    .values({ account_id: accountId, currency, amount })
    .onConflict((oc) => oc.columns(['account_id', 'currency']).doUpdateSet({ amount: sql`galaxy.balances.amount + ${amount}` }))
    .returning('amount')
    .executeTakeFirstOrThrow();
  const balance = Number(row.amount);
  await record(trx, accountId, currency, amount, balance, reason, ref, opKey);
  return balance;
}

/** Subtracts `amount` (> 0) or throws 402 insufficient_funds; returns the new balance. */
export async function debit(
  trx: Kysely<DB>,
  accountId: string,
  currency: Currency | string,
  amount: number,
  reason: string,
  ref: unknown = {},
  opKey: string | null = null,
): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError(`debit amount must be a positive integer: ${amount}`);
  const row = await trx
    .updateTable('galaxy.balances')
    .set({ amount: sql`amount - ${amount}` })
    .where('account_id', '=', accountId)
    .where('currency', '=', currency)
    .where('amount', '>=', String(amount))
    .returning('amount')
    .executeTakeFirst();
  if (!row) throw new HttpError(402, 'insufficient_funds');
  const balance = Number(row.amount);
  await record(trx, accountId, currency, -amount, balance, reason, ref, opKey);
  return balance;
}

/**
 * Takes up to `amount` (> 0), never below 0 (a refund taking back what is left of a purchase; shop and lab plan, F4):
 * returns what it took, recorded in the ledger like any debit. The balance row is locked while it decides.
 */
export async function debitUpTo(
  trx: Kysely<DB>,
  accountId: string,
  currency: Currency | string,
  amount: number,
  reason: string,
  ref: unknown = {},
  opKey: string | null = null,
): Promise<number> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError(`debit amount must be a positive integer: ${amount}`);
  const row = await trx.selectFrom('galaxy.balances').select('amount').where('account_id', '=', accountId).where('currency', '=', currency).forUpdate().executeTakeFirst();
  const taken = Math.min(Number(row?.amount ?? 0), amount);
  if (taken <= 0) return 0;
  const after = await trx
    .updateTable('galaxy.balances')
    .set({ amount: sql`amount - ${taken}` })
    .where('account_id', '=', accountId)
    .where('currency', '=', currency)
    .returning('amount')
    .executeTakeFirstOrThrow();
  await record(trx, accountId, currency, -taken, Number(after.amount), reason, ref, opKey);
  return taken;
}
