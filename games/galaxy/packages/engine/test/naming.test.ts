import { expect, test } from 'vitest';
import { galaxyName, properName, subRng, tokenSeed } from '../src/index';
import { loadGolden } from './golden';

// naming.proper_name (galaxy-nft), exported from Python for 300 seeds: the name on every card.
const golden = loadGolden<{ names: Array<{ index: number; seed: string; name: string }> }>('names.json');

test('los 300 nombres coinciden con los de Python', () => {
  expect(golden.names).toHaveLength(300);
  for (const { seed, name } of golden.names) {
    expect(galaxyName(BigInt(seed)), seed).toBe(name);
    expect(properName(subRng(BigInt(seed), 'name'))).toBe(name);
  }
});

test('un nombre empieza en mayúscula y no repite sílabas seguidas', () => {
  for (let i = 1; i <= 500; i++) {
    const name = galaxyName(tokenSeed(20261104, 10_000 + i));
    expect(name[0]).toBe(name[0]!.toUpperCase());
    expect(name).not.toMatch(/^(.+)\1/i);
  }
});
