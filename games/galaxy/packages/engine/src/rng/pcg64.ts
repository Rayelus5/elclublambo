// numpy's PCG64 (XSL-RR 128/64) seeded through SeedSequence — ENGINE_PORT §2.2 and §2.3.
//
// Seeding runs once per stream and uses BigInt. Stepping runs for every random number (a 192-column render draws
// ~700k of them), so the 128-bit state lives in eight 16-bit limbs: each limb product is < 2^32 and a column sum of
// eight products plus carry stays < 2^36, exact in a double.

const MASK128 = (1n << 128n) - 1n;
const MULT = 0x2360ed051fc65da44385df649fccf645n;

const INIT_A = 0x43b0d7e5;
const MULT_A = 0x931e8875;
const INIT_B = 0x8b51f9dd;
const MULT_B = 0x58f38ded;
const MIX_MULT_L = 0xca01f9dd;
const MIX_MULT_R = 0x4973f715;
const POOL_SIZE = 4;

/** SeedSequence(entropy).generate_state(4, uint64), as four 64-bit words. */
export function seedSequenceState(entropy: bigint): [bigint, bigint, bigint, bigint] {
  if (entropy < 0n) throw new RangeError('SeedSequence entropy must be non-negative');
  const words: number[] = [];
  let e = entropy;
  do {
    words.push(Number(e & 0xffffffffn));
    e >>= 32n;
  } while (e > 0n);

  let hashConst = INIT_A;
  const hashmix = (value: number): number => {
    let v = (value ^ hashConst) >>> 0;
    hashConst = Math.imul(hashConst, MULT_A) >>> 0;
    v = Math.imul(v, hashConst) >>> 0;
    return (v ^ (v >>> 16)) >>> 0;
  };
  const mix = (x: number, y: number): number => {
    const r = (Math.imul(MIX_MULT_L, x) - Math.imul(MIX_MULT_R, y)) >>> 0;
    return (r ^ (r >>> 16)) >>> 0;
  };

  const pool = new Array<number>(POOL_SIZE);
  for (let i = 0; i < POOL_SIZE; i++) pool[i] = hashmix(i < words.length ? words[i]! : 0);
  for (let src = 0; src < POOL_SIZE; src++) {
    for (let dst = 0; dst < POOL_SIZE; dst++) {
      if (src !== dst) pool[dst] = mix(pool[dst]!, hashmix(pool[src]!));
    }
  }
  for (let src = POOL_SIZE; src < words.length; src++) {
    for (let dst = 0; dst < POOL_SIZE; dst++) pool[dst] = mix(pool[dst]!, hashmix(words[src]!));
  }

  let hashB = INIT_B;
  const out32: number[] = [];
  for (let i = 0; i < 8; i++) {
    let x = (pool[i % POOL_SIZE]! ^ hashB) >>> 0;
    hashB = Math.imul(hashB, MULT_B) >>> 0;
    x = Math.imul(x, hashB) >>> 0;
    out32.push((x ^ (x >>> 16)) >>> 0);
  }
  const w = (k: number) => BigInt(out32[2 * k]!) | (BigInt(out32[2 * k + 1]!) << 32n);
  return [w(0), w(1), w(2), w(3)];
}

/** pcg64_set_seed + pcg_setseq_128_srandom_r from the SeedSequence words. */
export function pcg64Seed(seed: bigint): { state: bigint; inc: bigint } {
  const [s0, s1, s2, s3] = seedSequenceState(seed);
  const initState = (s0 << 64n) | s1;
  const initSeq = (s2 << 64n) | s3;
  const inc = ((initSeq << 1n) | 1n) & MASK128;
  let state = inc & MASK128; // state = 0; step()
  state = (state + initState) & MASK128;
  state = (state * MULT + inc) & MASK128;
  return { state, inc };
}

function toLimbs(x: bigint): Uint16Array {
  const limbs = new Uint16Array(8);
  for (let k = 0; k < 8; k++) limbs[k] = Number((x >> BigInt(16 * k)) & 0xffffn);
  return limbs;
}

function fromLimbs(limbs: Uint16Array): bigint {
  let x = 0n;
  for (let k = 7; k >= 0; k--) x = (x << 16n) | BigInt(limbs[k]!);
  return x;
}

const MULT_LIMBS = toLimbs(MULT);

export class Pcg64 {
  private readonly s: Uint16Array;
  private readonly inc: Uint16Array;
  private readonly next = new Uint16Array(8);
  private hasUint32 = false;
  private uinteger = 0;
  /** Last 64-bit output as two unsigned 32-bit halves (no allocation per draw). */
  hi = 0;
  lo = 0;

  constructor(seed: bigint) {
    const { state, inc } = pcg64Seed(seed);
    this.s = toLimbs(state);
    this.inc = toLimbs(inc);
  }

  get state(): { state: bigint; inc: bigint } {
    return { state: fromLimbs(this.s), inc: fromLimbs(this.inc) };
  }

  private step(): void {
    const s = this.s;
    const out = this.next;
    let carry = 0;
    for (let k = 0; k < 8; k++) {
      let sum = carry + this.inc[k]!;
      for (let i = 0; i <= k; i++) sum += s[i]! * MULT_LIMBS[k - i]!;
      out[k] = sum; // a Uint16Array store keeps the low 16 bits
      carry = Math.floor(sum / 65536);
    }
    s.set(out);
  }

  /** next64(): step, then XSL-RR on the new state. Result in `hi`/`lo`. */
  next64(): void {
    this.step();
    const s = this.s;
    const xh = (((s[7]! << 16) | s[6]!) ^ ((s[3]! << 16) | s[2]!)) >>> 0;
    const xl = (((s[5]! << 16) | s[4]!) ^ ((s[1]! << 16) | s[0]!)) >>> 0;
    const rot = s[7]! >>> 10; // (state >> 64) >> 58
    if (rot === 0) {
      this.hi = xh;
      this.lo = xl;
    } else if (rot < 32) {
      this.lo = ((xl >>> rot) | (xh << (32 - rot))) >>> 0;
      this.hi = ((xh >>> rot) | (xl << (32 - rot))) >>> 0;
    } else if (rot === 32) {
      this.hi = xl;
      this.lo = xh;
    } else {
      const q = rot - 32;
      this.lo = ((xh >>> q) | (xl << (32 - q))) >>> 0;
      this.hi = ((xl >>> q) | (xh << (32 - q))) >>> 0;
    }
  }

  /** next_double(): a fresh 64-bit word, top 53 bits; the 32-bit buffer is left alone. */
  nextDouble(): number {
    this.next64();
    return (this.hi * 2097152 + (this.lo >>> 11)) * 1.1102230246251565e-16; // 2^21, 2^-53
  }

  /** next_uint32(): low half of a fresh word first, the high half is kept for the next call. */
  next32(): number {
    if (this.hasUint32) {
      this.hasUint32 = false;
      return this.uinteger;
    }
    this.next64();
    this.hasUint32 = true;
    this.uinteger = this.hi;
    return this.lo;
  }

  /** random_raw(): the raw 64-bit output; does not touch the 32-bit buffer. */
  nextRaw(): bigint {
    this.next64();
    return (BigInt(this.hi) << 32n) | BigInt(this.lo);
  }
}
