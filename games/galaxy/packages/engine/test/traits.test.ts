import { describe, expect, test } from 'vitest';
import { dna, drawTraits, Generator, sha256Hex, subRng, tokenSeed, violations, type Traits } from '../src/index';
import { loadGolden } from './golden';

// ENGINE_PORT §3.1–§3.3: TraitSampler.draw, violations and DNA, against 500 + 30 draws exported from Python.
type Draw = {
  seed: string;
  fixed: Partial<Traits> | null;
  traits: Traits;
  dna: string;
  violations: string[];
  next_random: number;
};
const golden = loadGolden<{ draws: Array<Draw & { index: number }>; fixed_draws: Draw[] }>('traits.json');

function check(d: Draw) {
  const rng = subRng(BigInt(d.seed), 'traits');
  const traits = drawTraits(rng, d.fixed ?? undefined);
  const label = `${d.seed} ${JSON.stringify(d.fixed)}`;
  expect(traits, label).toEqual(d.traits);
  expect(Object.keys(traits), label).toEqual(Object.keys(d.traits)); // dict order = draw order
  expect(dna(traits), label).toBe(d.dna);
  expect(violations(traits), label).toEqual(d.violations);
  // Same number of doubles consumed as numpy: the next one matches.
  expect(rng.random(), label).toBe(d.next_random);
}

describe('sorteo de rasgos', () => {
  test('los 500 sorteos de token_seed(20261104, i) y su DNA son idénticos', () => {
    expect(golden.draws).toHaveLength(500);
    for (const d of golden.draws) check(d);
  });

  test('los 30 sorteos con rasgos fijados son idénticos, con sus incompatibilidades', () => {
    expect(golden.fixed_draws).toHaveLength(30);
    for (const d of golden.fixed_draws) check(d);
  });

  test('fijar size: large nunca da una enana', () => {
    for (let i = 1; i <= 2000; i++) {
      expect(drawTraits(subRng(tokenSeed(20261104, i), 'traits'), { size: 'large' }).galaxy_type).not.toBe('dwarf');
    }
  });

  test('antimatter fuerza deep_void sin consumir el número del fondo (Review Focus 2)', () => {
    for (let i = 1; i <= 50; i++) {
      const seed = tokenSeed(20261104, 7000 + i);
      const rng = subRng(seed, 'traits');
      const traits = drawTraits(rng, { palette: 'antimatter' });
      expect(traits.background).toBe('deep_void');
      // One double per drawn trait: present, not fixed (palette), not forced (background).
      const drawn = Object.keys(traits).filter((k) => k !== 'palette' && k !== 'background').length;
      const replay = subRng(seed, 'traits');
      for (let k = 0; k < drawn; k++) replay.random();
      expect(rng.random()).toBe(replay.random());
    }
  });

  test('un valor fijado desconocido se rechaza', () => {
    expect(() => drawTraits(new Generator(1n), { galaxy_type: 'blackhole' })).toThrow(RangeError);
  });

  test('el DNA usa el orden de sorteo y solo los rasgos presentes', () => {
    const traits = {
      galaxy_type: 'elliptical',
      size: 'large',
      core: 'bright',
      star_density: 'normal',
      palette: 'crimson_nebula',
      background: 'nebular_dust',
      phenomenon: 'none',
    } satisfies Traits;
    // ENGINE_PORT §3.3 canonical string: no arms or inclination for an elliptical.
    expect(dna(traits)).toBe(
      sha256Hex(
        'galaxy_type=elliptical|size=large|core=bright|star_density=normal|palette=crimson_nebula|background=nebular_dust|phenomenon=none',
      ),
    );
    expect(dna({ ...traits, phenomenon: 'comet' })).not.toBe(dna(traits));
  });
});
