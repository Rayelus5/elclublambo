import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Contraseña de mantenimiento (A-R10): scrypt de node:crypto, formato `scrypt$N$r$p$<sal b64>$<hash b64>`.
// Ni la contraseña ni el hash salen nunca de aquí hacia un log.

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024;

const FORMAT = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function derive(plain: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain.normalize("NFC"), salt, keylen, { ...options, maxmem: MAXMEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(plain, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

/** Base64 canónico (lo que `toString("base64")` devuelve), o null si está roto. */
function decode(b64: string): Buffer | null {
  const buf = Buffer.from(b64, "base64");
  return buf.length > 0 && buf.toString("base64") === b64 ? buf : null;
}

/**
 * `false` ante cualquier formato inválido o parámetro fuera de rango (un valor guardado manipulado no puede pedir un
 * scrypt enorme). Nunca lanza.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const m = FORMAT.exec(stored);
    if (!m) return false;
    const [n, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (n < 2 ** 14 || n > 2 ** 17 || (n & (n - 1)) !== 0 || r < 1 || r > 16 || p < 1 || p > 4) return false;
    const salt = decode(m[4]!);
    const expected = decode(m[5]!);
    if (!salt || !expected || salt.length < SALT_BYTES || expected.length < 32 || expected.length > 128) return false;
    const actual = await derive(plain, salt, expected.length, { N: n, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
