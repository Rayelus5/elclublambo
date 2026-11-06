import { hash, verify } from '@node-rs/argon2';

/** argon2id (Algorithm.Argon2id = 2; the package exports it as a const enum). OWASP parameters. */
const OPTIONS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

/** A malformed hash is a wrong password, never an exception. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Hash of a random secret nobody knows, verified when the username does not exist so that a wrong username takes as
 * long as a wrong password (no account enumeration by timing).
 */
export const DUMMY_HASH = '$argon2id$v=19$m=19456,t=2,p=1$vj4K2sa+lwERX+1Jm/EF6Q$nmgFoWgG+wVCWatUqmrQI+3iAR8Qgm7nBHnaEMcrmYY';
