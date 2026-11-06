import { describe, expect, test } from 'vitest';
import { deriveSeed, Generator, subRng, subSeed32, tokenSeed } from '../src/index';
import { loadGolden } from './golden';

// ENGINE_PORT §2: seeds, numpy SeedSequence → PCG64 and the Generator methods, bit for bit against numpy 2.5.4.
type Call = [[string, ...unknown[]], unknown];
type RngGolden = {
  derive_seed: Array<{ parts: string[]; part_types: Array<'int' | 'str'>; value: string }>;
  token_seed: Array<{ master: number; index: number; value: string }>;
  sub_seeds: { seed: string; streams: Record<string, { derive: string; seed32: number }> };
  pcg64: Array<{ seed: string; state: string; inc: string; random_raw: string[]; random: number[] }>;
  sequences: Array<{ seed: string; calls: Call[]; next_raw: string }>;
};
const golden = loadGolden<RngGolden>('rng.json');

function run(g: Generator, [name, ...args]: Call[0]): unknown {
  const n = (i: number) => args[i] as number;
  switch (name) {
    case 'random':
      return g.random();
    case 'random_n':
      return Array.from(g.randomArray(n(0)));
    case 'uniform':
      return g.uniform(n(0), n(1));
    case 'uniform_n':
      return Array.from(g.uniformArray(n(0), n(1), n(2)));
    case 'integers':
      return g.integers(n(0), n(1));
    case 'choice_p': {
      const w = args[0] as number[];
      const sum = w.reduce((a, b) => a + b, 0);
      return g.choiceP(w.map((x) => x / sum));
    }
    case 'choice_sign':
      return g.sign();
    case 'permutation':
      return Array.from(g.permutation(n(0)));
    case 'choice_without_replacement':
      return g.sampleWithoutReplacement(
        Array.from({ length: n(0) }, (_, i) => i),
        n(1),
      );
    default:
      throw new Error(`unknown call ${name}`);
  }
}

describe('semillas', () => {
  test('deriveSeed y tokenSeed dan los valores de Python', () => {
    expect(deriveSeed('token', 20261104, 1)).toBe(8592738875135951460n);
    expect(tokenSeed(20261104, 1)).toBe(8592738875135951460n);
    for (const { parts, part_types, value } of golden.derive_seed) {
      const args = parts.map((p, i) => (part_types[i] === 'int' ? BigInt(p) : p));
      expect(deriveSeed(...args), parts.join(' | ')).toBe(BigInt(value));
    }
    for (const { master, index, value } of golden.token_seed) expect(tokenSeed(master, index)).toBe(BigInt(value));
  });

  test('las semillas de cada flujo y sus 32 bits coinciden (§2.7)', () => {
    const seed = BigInt(golden.sub_seeds.seed);
    for (const [name, { derive, seed32 }] of Object.entries(golden.sub_seeds.streams)) {
      expect(deriveSeed(seed, name), name).toBe(BigInt(derive));
      expect(subSeed32(seed, name), name).toBe(seed32);
    }
    expect(subSeed32(seed, 'geometry')).toBe(424754098);
  });

  test('una semilla de 64 bits nunca pasa por Number (Review Focus 1)', () => {
    // 2^63 + 12345 as a Number would round to 2^63; the exact decimal is what Python hashes.
    expect(() => deriveSeed(2 ** 63)).toThrow(RangeError);
    expect(() => deriveSeed(1.5)).toThrow(RangeError);
    expect(deriveSeed(2n ** 63n + 12345n, 'x')).not.toBe(deriveSeed(2n ** 63n, 'x'));
  });
});

describe('PCG64', () => {
  test('el estado tras la siembra y las primeras salidas coinciden con numpy', () => {
    for (const { seed, state, inc, random_raw, random } of golden.pcg64) {
      const g = new Generator(BigInt(seed));
      expect(g.state, seed).toEqual({ state: BigInt(state), inc: BigInt(inc) });
      expect([g.randomRaw(), g.randomRaw(), g.randomRaw()], seed).toEqual(random_raw.map((h) => BigInt(h)));
      const d = new Generator(BigInt(seed));
      expect([d.random(), d.random(), d.random()], seed).toEqual(random);
    }
    expect(new Generator(3529837714663881650n).random()).toBe(0.5961096316747411);
  });

  test('subRng siembra con deriveSeed(seed, name)', () => {
    const seed = BigInt(golden.sub_seeds.seed);
    expect(subRng(seed, 'geometry').state).toEqual(new Generator(deriveSeed(seed, 'geometry')).state);
  });

  test.each(golden.sequences.map((s) => [s.seed, s] as const))(
    'la secuencia intercalada de 32 y 64 bits de la semilla %s es idéntica',
    (_, { seed, calls, next_raw }) => {
      const g = new Generator(BigInt(seed));
      calls.forEach(([call, expected], i) => {
        expect(run(g, call), `call ${i}: ${JSON.stringify(call)}`).toEqual(expected);
      });
      // The half-word buffer leaves the generator exactly where numpy's is.
      expect(g.randomRaw()).toBe(BigInt(next_raw));
    },
  );
});

describe('validación', () => {
  test('choiceP rechaza probabilidades que no suman 1 y negativas', () => {
    const g = new Generator(1n);
    expect(() => g.choiceP([0.5, 0.4])).toThrow(RangeError);
    expect(() => g.choiceP([1.2, -0.2])).toThrow(RangeError);
  });

  test('integers(a, a + 1) no consume números', () => {
    const a = new Generator(7n);
    const b = new Generator(7n);
    expect(a.integers(5, 6)).toBe(5);
    expect(a.random()).toBe(b.random());
  });

  test('sampleWithoutReplacement no admite más elementos que la población', () => {
    expect(() => new Generator(1n).sampleWithoutReplacement([1, 2, 3], 4)).toThrow(RangeError);
  });
});
