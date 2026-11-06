import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes in base64url; the database only ever sees the sha256. */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
