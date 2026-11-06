import { sha256 } from './sha256';

// ENGINE_PORT §2.1: derive_seed(*parts) = first 8 bytes, big-endian, of sha256("\x1f".join(str(p))).
export type SeedPart = string | number | bigint;

function part(p: SeedPart): string {
  if (typeof p === 'bigint') return p.toString();
  if (typeof p === 'number') {
    // A 64-bit seed held in a Number has already lost digits: Python would hash a different decimal.
    if (!Number.isSafeInteger(p)) throw new RangeError(`seed part ${p} is not a safe integer; pass a bigint`);
    return String(p);
  }
  return p;
}

export function deriveSeed(...parts: SeedPart[]): bigint {
  const digest = sha256(parts.map(part).join('\x1f'));
  let seed = 0n;
  for (let i = 0; i < 8; i++) seed = (seed << 8n) | BigInt(digest[i]!);
  return seed;
}

export function subSeed32(seed: bigint, name: string): number {
  return Number(deriveSeed(seed, name) & 0xffffffffn);
}

export function tokenSeed(master: number, index: number): bigint {
  return deriveSeed('token', master, index);
}
