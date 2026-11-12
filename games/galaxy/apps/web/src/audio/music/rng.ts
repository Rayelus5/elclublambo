// The soundtrack's seeded random (plan «banda sonora», part A): a piece varies from one loop to the next, but always
// the same way for the same seed, so it can be heard again, tested and directed. Never Math.random.

/** A 32-bit seed from any parts (FNV-1a over their text). */
export function seedOf(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Mulberry32: numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One of a list, by the random. */
export const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length) % list.length]!;
