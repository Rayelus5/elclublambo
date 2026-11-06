import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { blackbodyLinear, linearToSrgb, loadPalette, PALETTES, srgbToLinear } from '../src/index';
import { loadGolden } from './golden';

// ENGINE_PORT §4.3: OKLab gradients in 1024-entry float32 LUTs, sampled with rint (half to even), and the
// Tanner Helland black body. Everything is compared bit for bit against numpy.
type Rgb = [number, number, number];
type PaletteGolden = {
  key: string;
  mode: string;
  inverted: boolean;
  angular: boolean;
  accent: Rgb;
  background: Rgb;
  blackbody_mix: number;
  detail: Rgb | null;
  detail_regions: number;
  detail_halo: number;
  detail_stars: number;
  postfx: Record<string, unknown>;
  lut_sha256: string;
  lut_cyclic_sha256: string;
  sample: Rgb[];
  sample_cyclic: Rgb[];
};
const golden = loadGolden<{
  lut_size: number;
  x: number[];
  palettes: PaletteGolden[];
  blackbody: { temperature: number[]; linear: Rgb[] };
}>('colors.json');

const lutHash = (lut: Float32Array) => bytesToHex(sha256(new Uint8Array(lut.buffer, lut.byteOffset, lut.byteLength)));

describe('paletas', () => {
  test('hay una por cada entrada de palettes.yaml, en orden', () => {
    expect(golden.palettes.map((p) => p.key)).toEqual([...PALETTES.keys()]);
  });

  test.each(golden.palettes.map((p) => [p.key, p] as const))('%s: LUT, muestras y colores fijos idénticos', (key, p) => {
    const palette = loadPalette(key);
    expect(palette.mode).toBe(p.mode);
    expect(palette.inverted).toBe(p.inverted);
    expect(palette.angular).toBe(p.angular);
    expect(palette.accent).toEqual(p.accent);
    expect(palette.background).toEqual(p.background);
    expect(palette.blackbodyMix).toBe(p.blackbody_mix);
    expect(palette.detail).toEqual(p.detail);
    expect([palette.detailRegions, palette.detailHalo, palette.detailStars]).toEqual([
      p.detail_regions,
      p.detail_halo,
      p.detail_stars,
    ]);
    expect(palette.postfx).toEqual(p.postfx);
    // All 1024 × 3 values of both LUTs, as float32 little-endian bytes.
    expect(lutHash(palette.lut), 'lut').toBe(p.lut_sha256);
    expect(lutHash(palette.lutCyclic), 'lut_cyclic').toBe(p.lut_cyclic_sha256);
    golden.x.forEach((x, i) => {
      expect(palette.sample(x), `sample(${x})`).toEqual(p.sample[i]);
      expect(palette.sampleCyclic(x), `sampleCyclic(${x})`).toEqual(p.sample_cyclic[i]);
    });
  });

  test('una paleta desconocida se rechaza', () => {
    expect(() => loadPalette('vantablack')).toThrow(RangeError);
  });
});

describe('cuerpo negro y sRGB', () => {
  test('blackbodyLinear coincide en float32 en las 12 temperaturas', () => {
    golden.blackbody.temperature.forEach((t, i) => {
      expect(blackbodyLinear(t), `${t} K`).toEqual(golden.blackbody.linear[i]);
    });
    // ENGINE_PORT §4.3 vectors.
    expect(blackbodyLinear(6600)).toEqual([1, 1, 1]);
    expect(blackbodyLinear(3200)).toEqual([1, 0.4771154522895813, 0.19848378002643585]);
  });

  test('srgbToLinear y linearToSrgb son inversas (salvo el codo de sRGB, ~3e-8) y recortan a [0, 1]', () => {
    for (const c of [0, 0.002, 0.04045, 0.2, 0.5, 1]) expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 6);
    expect(linearToSrgb(-0.5)).toBe(0);
    expect(linearToSrgb(3)).toBeCloseTo(1, 12);
  });
});
