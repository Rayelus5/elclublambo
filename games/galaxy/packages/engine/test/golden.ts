import { readFileSync } from 'node:fs';
import type { Traits } from '../src/index';

// Golden references exported from the Python engine by tools/golden/export.py (ENGINE_PORT §9.5). They freeze v1.
const root = new URL('./golden/v1/', import.meta.url);

export function loadGolden<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(file, root), 'utf8')) as T;
}

export function goldenBytes(file: string): Buffer {
  return readFileSync(new URL(file, root));
}

/** Field values from the Python engine: equal, or within `rel` relative error (libm may differ by an ulp). */
export function expectClose(actual: ArrayLike<number>, expected: ArrayLike<number>, rel: number, label: string): void {
  if (actual.length !== expected.length) throw new Error(`${label}: length ${actual.length} != ${expected.length}`);
  let worst = -1;
  let worstErr = 0;
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i]!;
    const b = expected[i]!;
    if (a === b) continue;
    const err = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b));
    if (!(err <= rel) && (worst < 0 || err > worstErr || Number.isNaN(err))) {
      worst = i;
      worstErr = err;
    }
  }
  if (worst >= 0) {
    throw new Error(`${label}[${worst}]: ${actual[worst]} vs ${expected[worst]} (relative error ${worstErr})`);
  }
}

export type CaseSamples = {
  dots: Array<[number, number]>;
  gal_t: number[];
  gal_young: number[];
  t_bg: number[];
  light_t: number[] | null;
  dot_color: Array<[number, number, number]>;
  dot_radius: number[];
  frame_r: number[] | null;
  frame_th: number[] | null;
  disk_d: number[] | null;
  disk_young: number[] | null;
};

export type CaseLod = {
  columns: number;
  nx: number;
  ny: number;
  braille: string;
  braille_sha256: string;
  dots_on: number;
  params: Record<string, unknown>;
  postfx: Record<string, unknown>;
  samples: CaseSamples;
};

export type GoldenCase = {
  name: string;
  seed: string;
  fixed: Record<string, string>;
  traits: Traits;
  dna: string;
  image: string | null;
  lods: Record<'192' | '96' | '48', CaseLod>;
};

export function loadCases(): GoldenCase[] {
  const meta = loadGolden<{ cases: string[] }>('meta.json');
  return meta.cases.map((name) => loadGolden<GoldenCase>(`cases/${name}.json`));
}

export const LODS = [192, 96, 48] as const;

export function lodOf(c: GoldenCase, columns: (typeof LODS)[number]): CaseLod {
  return c.lods[String(columns) as '192'];
}
