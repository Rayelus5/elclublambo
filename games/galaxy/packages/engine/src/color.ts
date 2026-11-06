import { PALETTES, RENDER } from './config/generated';
import type { PaletteSpec, PostfxOverride } from './config/types';

// color.py (ENGINE_PORT §4.3): sRGB / linear / OKLab, 1024-entry gradient LUTs and the black body colour. The whole
// render works in linear RGB; sRGB is only applied at the end. Dot products are written left to right, as the scalar
// float64 code that reproduces numpy's LUTs exactly.
export type Rgb = [number, number, number];

export const LUT_SIZE = 1024;

const M1 = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
] as const;
const M2 = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
] as const;
const M2_INV = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
] as const;
const M1_INV = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
] as const;
const LUMA = [Math.fround(0.2126), Math.fround(0.7152), Math.fround(0.0722)] as const;

type Mat = readonly (readonly [number, number, number])[];
const mul = (m: Mat, v: readonly number[]): Rgb => [
  m[0]![0] * v[0]! + m[0]![1] * v[1]! + m[0]![2] * v[2]!,
  m[1]![0] * v[0]! + m[1]![1] * v[1]! + m[1]![2] * v[2]!,
  m[2]![0] * v[0]! + m[2]![1] * v[1]! + m[2]![2] * v[2]!,
];

/** numpy.rint: round half to even. */
export function rint(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export function hexToSrgb(code: string): Rgb {
  const h = code.replace(/^#/, '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(value: number): number {
  const c = Math.min(Math.max(value, 0), 1);
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** hex → linear RGB, rounded to float32 like `hex_to_linear`. */
export function hexToLinear(code: string): Rgb {
  const [r, g, b] = hexToSrgb(code);
  return [Math.fround(srgbToLinear(r)), Math.fround(srgbToLinear(g)), Math.fround(srgbToLinear(b))];
}

export function linearToOklab(rgb: readonly number[]): Rgb {
  const lms = mul(M1, rgb);
  return mul(M2, [Math.cbrt(lms[0]), Math.cbrt(lms[1]), Math.cbrt(lms[2])]);
}

export function oklabToLinear(lab: readonly number[]): Rgb {
  const lms = mul(M2_INV, lab);
  return mul(M1_INV, [Math.pow(lms[0], 3), Math.pow(lms[1], 3), Math.pow(lms[2], 3)]);
}

/** Gradient interpolated in OKLab, returned in linear RGB as float32 (`gradient_lut`). */
export function gradientLut(stopsLinear: readonly Rgb[], cyclic = false, size = LUT_SIZE): Float32Array {
  const labs = stopsLinear.map(linearToOklab);
  if (cyclic) labs.push(labs[0]!);
  const n = labs.length - 1;
  const step = 1 / (size - 1);
  const lut = new Float32Array(size * 3);
  for (let k = 0; k < size; k++) {
    const x = (k === size - 1 ? 1 : k * step) * n; // np.linspace(0, 1, size) * n
    const i = Math.min(Math.floor(x), n - 1);
    const f = x - i;
    const a = labs[i]!;
    const b = labs[i + 1]!;
    const rgb = oklabToLinear([a[0] * (1 - f) + b[0] * f, a[1] * (1 - f) + b[1] * f, a[2] * (1 - f) + b[2] * f]);
    lut[3 * k] = Math.max(rgb[0], 0);
    lut[3 * k + 1] = Math.max(rgb[1], 0);
    lut[3 * k + 2] = Math.max(rgb[2], 0);
  }
  return lut;
}

/** LUT index of `sample(x)`: rint(clip(x, 0, 1) * 1023). */
export function lutIndex(x: number): number {
  return rint(Math.min(Math.max(x, 0), 1) * (LUT_SIZE - 1));
}

/** LUT index of `sample_cyclic(x)`: rint(mod(x, 1) * 1023), with numpy's sign rule for mod. */
export function cyclicIndex(x: number): number {
  let m = x % 1;
  if (m < 0) m += 1;
  return rint(m * (LUT_SIZE - 1));
}

export class Palette {
  readonly mode: 'normal' | 'angular' | 'inverted';
  readonly inverted: boolean;
  readonly angular: boolean;
  readonly lut: Float32Array;
  readonly lutCyclic: Float32Array;
  readonly accent: Rgb;
  readonly background: Rgb;
  readonly blackbodyMix: number;
  readonly detail: Rgb | null;
  readonly detailRegions: number;
  readonly detailHalo: number;
  readonly detailStars: number;
  readonly postfx: PostfxOverride;

  constructor(
    readonly key: string,
    spec: PaletteSpec,
    defaultBackground: string,
    defaultBlackbodyMix: number,
  ) {
    this.mode = spec.mode ?? 'normal';
    this.inverted = this.mode === 'inverted';
    this.angular = this.mode === 'angular';
    const stops = spec.stops.map((h) => hexToSrgb(h).map(srgbToLinear) as Rgb);
    this.lut = gradientLut(stops);
    this.lutCyclic = gradientLut(stops, true);
    this.accent = hexToLinear(spec.accent);
    this.background = hexToLinear(spec.background ?? defaultBackground);
    this.blackbodyMix = spec.blackbody_mix ?? defaultBlackbodyMix;
    this.detail = spec.detail ? hexToLinear(spec.detail.color) : null;
    this.detailRegions = spec.detail?.regions ?? 0;
    this.detailHalo = spec.detail?.halo ?? 0;
    this.detailStars = spec.detail?.stars ?? 0;
    this.postfx = { ...(spec.postfx ?? {}) };
  }

  /** Gradient colour at x ∈ [0, 1] (low → high density). */
  sample(x: number): Rgb {
    const i = 3 * lutIndex(x);
    return [this.lut[i]!, this.lut[i + 1]!, this.lut[i + 2]!];
  }

  /** Colour of the closed gradient (angular palette). */
  sampleCyclic(x: number): Rgb {
    const i = 3 * cyclicIndex(x);
    return [this.lutCyclic[i]!, this.lutCyclic[i + 1]!, this.lutCyclic[i + 2]!];
  }
}

const cache = new Map<string, Palette>();

export function loadPalette(key: string): Palette {
  let palette = cache.get(key);
  if (!palette) {
    const spec = PALETTES.get(key);
    if (!spec) throw new RangeError(`unknown palette ${key}`);
    palette = new Palette(key, spec, RENDER.background_color, RENDER.blackbody_mix);
    cache.set(key, palette);
  }
  return palette;
}

/** Relative luminance of a float32 linear colour, accumulated in float32 like `rgb @ float32[...]`. */
export function luminance(r: number, g: number, b: number): number {
  return Math.fround(
    Math.fround(Math.fround(Math.fround(r * LUMA[0]) + Math.fround(g * LUMA[1])) + Math.fround(b * LUMA[2])),
  );
}

/** Approximate black body colour (Tanner Helland), normalised to its largest channel, as float32. */
export function blackbodyLinear(temperature: number): Rgb {
  const t = temperature / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(Math.max(t - 60, 1e-6), -0.1332047592);
  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(Math.max(t - 60, 1e-6), -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(Math.max(t - 10, 1e-6)) - 305.0447927307;
  const lin = [r, g, b].map((c) => srgbToLinear(Math.min(Math.max(c, 0), 255) / 255));
  const m = Math.max(Math.max(lin[0]!, lin[1]!, lin[2]!), 1e-6);
  return [Math.fround(lin[0]! / m), Math.fround(lin[1]! / m), Math.fround(lin[2]! / m)];
}
