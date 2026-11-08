import { createHash, randomInt } from 'node:crypto';
import { resetRedeemInput } from '@galaxy/shared';
import { type Kysely, sql } from 'kysely';
import { type AuditActor, writeAudit } from '../audit';
import type { DB } from '../db/schema';
import { inTransaction } from '../db/tx';
import { findAccountByUsername } from './accounts';
import { hashPassword } from './password';
import { revokeAllSessions } from './sessions';

/** 32 symbols: digits and letters without I, L, O, U (no look-alikes). 16 symbols = 80 bits. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ0123456789';

export class InvalidResetCodeError extends Error {
  constructor() {
    super('invalid_reset_code');
    this.name = 'InvalidResetCodeError';
  }
}

export class AccountNotFoundError extends Error {
  constructor() {
    super('account_not_found');
    this.name = 'AccountNotFoundError';
  }
}

/** Case and separators do not matter when typing the code back. */
function normalize(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function codeHash(code: string): Buffer {
  return createHash('sha256').update(normalize(code)).digest();
}

/** Admin-issued one-time recovery code (no email in the game), valid for 24 h. Audited, never stored in clear. */
export async function issueResetCode(db: Kysely<DB>, username: string, actor: AuditActor, reason = 'recuperación de contraseña'): Promise<string> {
  const account = await findAccountByUsername(db, username);
  if (!account) throw new AccountNotFoundError();
  const raw = Array.from({ length: 16 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const code = raw.match(/.{4}/g)!.join('-');
  await inTransaction(db, async (trx) => {
    await trx
      .insertInto('galaxy.reset_codes')
      .values({
        account_id: account.id,
        code_hash: codeHash(code),
        expires_at: sql<Date>`now() + interval '24 hours'`,
        created_by: actor.id,
      })
      .execute();
    await writeAudit(trx, {
      actor,
      action: 'account.reset_code_issued',
      targetType: 'account',
      targetId: account.id,
      after: { username: account.username },
      reason,
    });
  });
  return code;
}

/** Sets the new password, burns the code and closes every session of the account, all or nothing. */
export async function redeemResetCode(
  db: Kysely<DB>,
  input: { username: string; code: string; newPassword: string },
  now: Date,
): Promise<void> {
  const { username, code, newPassword } = resetRedeemInput.parse(input);
  const account = await findAccountByUsername(db, username);
  if (!account) throw new InvalidResetCodeError();
  const password_hash = await hashPassword(newPassword);
  await inTransaction(db, async (trx) => {
    const burned = await trx
      .updateTable('galaxy.reset_codes')
      .set({ used_at: now })
      .where('account_id', '=', account.id)
      .where('code_hash', '=', codeHash(code))
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    if (burned.numUpdatedRows !== 1n) throw new InvalidResetCodeError();
    await trx.updateTable('galaxy.accounts').set({ password_hash }).where('id', '=', account.id).execute();
    await revokeAllSessions(trx, account.id);
  });
}
