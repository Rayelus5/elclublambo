import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { type Kysely, sql } from 'kysely';
import { Secret, TOTP } from 'otpauth';
import type { DB } from '../db/schema';

const ISSUER = 'Galaxy Survivor';
const PERIOD = 30;

/** AES-256-GCM: iv(12) | tag(16) | ciphertext. The key (GALAXY_TOTP_KEY) never touches the database. */
export function encryptSecret(key: Buffer, base32: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(base32, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptSecret(key: Buffer, blob: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
}

function totpFor(base32: string, label = 'cuenta'): TOTP {
  return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: PERIOD, secret: Secret.fromBase32(base32) });
}

/** 160-bit secret (RFC 4226 recommendation) and its otpauth:// URI for authenticator apps. */
export function newTotpSecret(): { base32: string; uri(username: string): string } {
  const base32 = new Secret({ size: 20 }).base32;
  return { base32, uri: (username) => totpFor(base32, username).toString() };
}

/**
 * Checks a code with a ±1 step window and burns its step: the update only succeeds for a step greater than the last
 * one used, atomically, so the same code (or an older one) never opens a second session.
 */
export async function verifyTotp(
  db: Kysely<DB>,
  key: Buffer,
  accountId: string,
  code: string,
  now: Date,
): Promise<boolean> {
  const row = await db
    .selectFrom('galaxy.admin_totp')
    .select('secret_enc')
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  if (!row) return false;
  let secret: string;
  try {
    secret = decryptSecret(key, row.secret_enc);
  } catch {
    return false;
  }
  const delta = totpFor(secret).validate({ token: code, timestamp: now.getTime(), window: 1 });
  if (delta === null) return false;
  const step = Math.floor(now.getTime() / 1000 / PERIOD) + delta;
  const burned = await db
    .updateTable('galaxy.admin_totp')
    .set({ last_used_step: step })
    .where('account_id', '=', accountId)
    .where(sql<boolean>`last_used_step < ${step}`)
    .executeTakeFirst();
  return burned.numUpdatedRows === 1n;
}
