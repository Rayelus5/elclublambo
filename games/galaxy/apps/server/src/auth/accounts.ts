import { registerInput, usernameSchema } from '@galaxy/shared';
import type { Kysely, Selectable } from 'kysely';
import type { AccountsTable, DB } from '../db/schema';
import { hashPassword } from './password';

export type AccountRow = Selectable<AccountsTable>;

export class UsernameTakenError extends Error {
  constructor() {
    super('username_taken');
    this.name = 'UsernameTakenError';
  }
}

export class UsernameReservedError extends Error {
  constructor() {
    super('username_reserved');
    this.name = 'UsernameReservedError';
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/**
 * Creates an account. Input is validated with the shared schema (lowercase username, password rules); reserved names
 * need `allowReserved` (create-admin). A concurrent duplicate surfaces as the unique violation -> UsernameTakenError.
 */
export async function registerAccount(
  db: Kysely<DB>,
  input: { username: string; password: string },
  opts: { allowReserved?: boolean } = {},
): Promise<{ id: string }> {
  const { username, password } = registerInput.parse(input);
  if (!opts.allowReserved) {
    const reserved = await db
      .selectFrom('galaxy.reserved_usernames')
      .select('username')
      .where('username', '=', username)
      .executeTakeFirst();
    if (reserved) throw new UsernameReservedError();
  }
  const password_hash = await hashPassword(password);
  try {
    const row = await db
      .insertInto('galaxy.accounts')
      .values({ username, password_hash })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id: row.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new UsernameTakenError();
    throw err;
  }
}

/** Looks an account up by username in any case; invalid usernames simply find nothing. */
export async function findAccountByUsername(db: Kysely<DB>, username: string): Promise<AccountRow | undefined> {
  const parsed = usernameSchema.safeParse(username);
  if (!parsed.success) return undefined;
  return db.selectFrom('galaxy.accounts').selectAll().where('username', '=', parsed.data).executeTakeFirst();
}
