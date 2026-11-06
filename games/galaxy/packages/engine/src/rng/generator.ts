import { Pcg64 } from './pcg64';
import { deriveSeed } from './seed';

// numpy.random.Generator methods the engine uses, with numpy's exact algorithms (ENGINE_PORT §2.4).
const TWO_32 = 4294967296;
const P_TOLERANCE = Math.sqrt(Number.EPSILON); // numpy: |sum(p) - 1| <= sqrt(eps)

function genMask(max: number): number {
  let mask = max;
  for (let shift = 1; shift <= 16; shift *= 2) mask |= mask >>> shift;
  return mask >>> 0;
}

export class Generator {
  private readonly bits: Pcg64;

  constructor(seed: bigint) {
    this.bits = new Pcg64(seed);
  }

  get state(): { state: bigint; inc: bigint } {
    return this.bits.state;
  }

  randomRaw(): bigint {
    return this.bits.nextRaw();
  }

  random(): number {
    return this.bits.nextDouble();
  }

  randomArray(n: number): Float64Array {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = this.bits.nextDouble();
    return out;
  }

  uniform(lo: number, hi: number): number {
    const range = hi - lo;
    if (!Number.isFinite(range)) throw new RangeError('uniform: range exceeds valid bounds');
    return lo + range * this.bits.nextDouble();
  }

  uniformArray(lo: number, hi: number, n: number): Float64Array {
    const range = hi - lo;
    if (!Number.isFinite(range)) throw new RangeError('uniform: range exceeds valid bounds');
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = lo + range * this.bits.nextDouble();
    return out;
  }

  /** integers(lo, hi) with endpoint=False (dtype int64). */
  integers(lo: number, hi: number): number {
    if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi <= lo) {
      throw new RangeError(`integers: invalid range [${lo}, ${hi})`);
    }
    return lo + this.bounded(hi - 1 - lo);
  }

  /**
   * Uniform integer in [0, rng] — random_bounded_uint64 for rng < 2^32: Lemire's method on 32-bit draws that share
   * PCG64's half-word buffer. rng == 0 consumes nothing.
   */
  private bounded(rng: number): number {
    if (rng === 0) return 0;
    if (rng > 0xffffffff) throw new RangeError('bounded integers above 2^32 are not used by the engine');
    if (rng === 0xffffffff) return this.bits.next32();
    const excl = rng + 1;
    this.multiply(this.bits.next32(), excl);
    if (this.mLo < excl) {
      const threshold = (0xffffffff - rng) % excl;
      while (this.mLo < threshold) this.multiply(this.bits.next32(), excl);
    }
    return this.mHi;
  }

  private mHi = 0;
  private mLo = 0;

  /** Exact 64-bit product of two values below 2^32, as 32-bit halves (x * excl can pass 2^53). */
  private multiply(x: number, excl: number): void {
    const a = (x & 0xffff) * excl; // < 2^48
    const b = (x >>> 16) * excl; // < 2^48
    const t = (b % 65536) * 65536 + a; // < 2^49
    this.mHi = Math.floor(b / 65536) + Math.floor(t / TWO_32);
    this.mLo = t % TWO_32;
  }

  /** choice(len(p), p=p): one double, cdf = cumsum(p) / cdf[-1], searchsorted(side='right'). */
  choiceP(p: readonly number[]): number {
    let total = 0;
    for (const x of p) {
      if (!(x >= 0)) throw new RangeError('choice: probabilities must be non-negative');
      total += x;
    }
    if (p.length === 0 || Math.abs(total - 1) > P_TOLERANCE) {
      throw new RangeError('choice: probabilities do not sum to 1');
    }
    const cdf = new Float64Array(p.length);
    let acc = 0;
    for (let i = 0; i < p.length; i++) cdf[i] = acc += p[i]!;
    const last = cdf[p.length - 1]!;
    for (let i = 0; i < p.length; i++) cdf[i] = cdf[i]! / last;
    const u = this.bits.nextDouble();
    let i = 0;
    while (i < p.length && cdf[i]! <= u) i++;
    return i;
  }

  /** choice([-1, 1]). */
  sign(): -1 | 1 {
    return this.integers(0, 2) === 0 ? -1 : 1;
  }

  /** permutation(n): arange(n) shuffled with masked rejection (random_interval), not Lemire. */
  permutation(n: number): Int32Array {
    const arr = new Int32Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    for (let i = n - 1; i >= 1; i--) {
      const j = this.interval(i);
      const t = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = t;
    }
    return arr;
  }

  private interval(max: number): number {
    if (max === 0) return 0;
    const mask = genMask(max);
    let v: number;
    do v = (this.bits.next32() & mask) >>> 0;
    while (v > max);
    return v;
  }

  /** choice(pool, size=k, replace=False): Floyd's algorithm with numpy's hash set, then a Lemire shuffle. */
  sampleWithoutReplacement(pool: ArrayLike<number>, k: number): number[] {
    const pop = pool.length;
    if (!Number.isInteger(k) || k < 0 || k > pop) throw new RangeError(`cannot take ${k} from ${pop} without replacement`);
    if (k === 0) return [];
    if (pop > 10000 && k > Math.floor(pop / 50)) {
      throw new RangeError('choice without replacement: numpy tail-shuffle branch not ported (ENGINE_PORT §2.4)');
    }
    const mask = genMask(Math.trunc(1.2 * k));
    const hash = new Float64Array(mask + 1).fill(-1);
    const idx = new Array<number>(k);
    for (let j = pop - k; j < pop; j++) {
      const val = this.bounded(j);
      let loc = val & mask;
      while (hash[loc] !== -1 && hash[loc] !== val) loc = (loc + 1) & mask;
      if (hash[loc] === -1) {
        hash[loc] = val;
        idx[j - pop + k] = val;
      } else {
        loc = j & mask;
        while (hash[loc] !== -1) loc = (loc + 1) & mask;
        hash[loc] = j;
        idx[j - pop + k] = j;
      }
    }
    for (let i = k - 1; i >= 1; i--) {
      const jj = this.bounded(i);
      const t = idx[i]!;
      idx[i] = idx[jj]!;
      idx[jj] = t;
    }
    return idx.map((i) => pool[i]!);
  }
}

export function subRng(seed: bigint, name: string): Generator {
  return new Generator(deriveSeed(seed, name));
}
