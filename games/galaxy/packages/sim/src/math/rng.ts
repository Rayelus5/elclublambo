// Seeded random numbers for the simulation: sfc32 (32-bit words, only additions, xors, shifts and Math.imul, so every
// JS engine gives the same sequence). Each system draws from its own named stream, so tuning one system does not
// reshuffle the others.

const M = 0xffffffff;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(state: number): () => number {
  let s = state >>> 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    z ^= z >>> 16;
    return z >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  private constructor(a: number, b: number, c: number, d: number) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    for (let i = 0; i < 12; i++) this.next();
  }

  /** `seed`: a 64-bit unsigned integer in decimal (the run seed); `stream`: the system's name. */
  static fromSeed(seed: string, stream: string): Rng {
    const n = BigInt(seed);
    if (n < 0n || n >= 1n << 64n) throw new RangeError(`seed out of range: ${seed}`);
    const lo = Number(n & BigInt(M));
    const hi = Number((n >> 32n) & BigInt(M));
    const h = fnv1a(stream);
    const g1 = splitmix32((lo ^ h) >>> 0);
    const g2 = splitmix32((hi ^ Math.imul(h, 0x27d4eb2d)) >>> 0);
    const a = g1();
    const b = g1();
    const c = g2();
    const d = g2();
    return new Rng(a, b, c, d);
  }

  /** Next unsigned 32-bit integer. */
  next(): number {
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** In [0, 1). */
  float(): number {
    return this.next() / 4294967296;
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }

  /** In [a, b). */
  range(a: number, b: number): number {
    return a + this.float() * (b - a);
  }

  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new RangeError('pick from an empty list');
    return xs[this.int(xs.length)]!;
  }

  /** The four state words (for the run's state hash). */
  state(): readonly number[] {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }
}
