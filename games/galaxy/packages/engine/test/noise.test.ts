import { describe, expect, test } from 'vitest';
import { fbm, hash2, smoothstep, valueNoise, warpedFbm, worley } from '../src/index';
import { loadGolden } from './golden';

// ENGINE_PORT §5.4: integer hashing and polynomials (plus sqrt, which is exact), so every value equals numpy's.
type NoiseSeed = {
  seed: number;
  hash: number[];
  value_noise: number[];
  fbm: number[];
  'fbm_3_2_0.6': number[];
  warped_fbm: number[];
  'warped_fbm_1.0_3': number[];
  worley: [number[], number[], number[]];
  worley_jitter_1: [number[], number[], number[]];
};
const golden = loadGolden<{
  noise: { x: number[]; y: number[]; by_seed: NoiseSeed[] };
  smoothstep: { a: number; b: number; x: number[]; value: number[] };
}>('params.json');
const x = Float64Array.from(golden.noise.x);
const y = Float64Array.from(golden.noise.y);

describe.each(golden.noise.by_seed.map((s) => [s.seed, s] as const))('ruido con semilla %i', (seed, g) => {
  test('hash de celda', () => {
    expect(golden.noise.x.map((xi, i) => hash2(Math.floor(xi), Math.floor(golden.noise.y[i]!), seed))).toEqual(g.hash);
  });

  test('value noise, fBm y fBm deformado', () => {
    expect(Array.from(valueNoise(x, y, seed))).toEqual(g.value_noise);
    expect(Array.from(fbm(x, y, seed))).toEqual(g.fbm);
    expect(Array.from(fbm(x, y, seed, 3, 2.0, 0.6))).toEqual(g['fbm_3_2_0.6']);
    expect(Array.from(warpedFbm(x, y, seed))).toEqual(g.warped_fbm);
    expect(Array.from(warpedFbm(x, y, seed, 1.0, 3))).toEqual(g['warped_fbm_1.0_3']);
  });

  test('Worley F1, F2 y F3', () => {
    expect(worley(x, y, seed).map((a) => Array.from(a))).toEqual(g.worley);
    expect(worley(x, y, seed, 1.0).map((a) => Array.from(a))).toEqual(g.worley_jitter_1);
  });
});

test('smoothstep recorta y suaviza', () => {
  const { a, b, x: xs, value } = golden.smoothstep;
  expect(xs.map((v) => smoothstep(a, b, v))).toEqual(value);
});
