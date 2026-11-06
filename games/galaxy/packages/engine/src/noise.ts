// noise.py (ENGINE_PORT §5.4): deterministic value noise, fBm, warped fBm and Worley noise.
//
// The scalar functions are the engine's hot path (fields evaluate them per dot); the array wrappers mirror the numpy
// signatures. Every operation keeps numpy's order: the 32-bit hash is integer arithmetic and the rest is polynomial
// (plus sqrt, which is correctly rounded), so the results are identical to Python's, not just close.

const TO_UNIT = 1 / 4294967296;

/** 32-bit hash of a lattice cell → [0, 1). `ix`/`iy` are integers (numpy casts int64 → uint32 by wrapping). */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x165667b1) >>> 0;
  h = (h + (Math.imul(iy, 0x27d4eb2f) >>> 0)) >>> 0;
  h = (h + (Math.imul(seed, 0x9e3779b1) >>> 0)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x85ebca77) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae3d) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h * TO_UNIT;
}

export function valueNoiseAt(x: number, y: number, seed: number): number {
  const fx0 = Math.floor(x);
  const fy0 = Math.floor(y);
  const fx = x - fx0;
  const fy = y - fy0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(fx0, fy0, seed);
  const b = hash2(fx0 + 1, fy0, seed);
  const c = hash2(fx0, fy0 + 1, seed);
  const d = hash2(fx0 + 1, fy0 + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractional Brownian motion normalised to [0, 1]. */
export function fbmAt(x: number, y: number, seed: number, octaves = 5, lacunarity = 2.03, gain = 0.5): number {
  let total = 0;
  let amp = 0.5;
  let freq = 1.0;
  let norm = 0.0;
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoiseAt(x * freq + i * 17.13, y * freq - i * 11.71, seed + i * 1013);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return total / norm;
}

/** fBm with domain warping: more organic shapes, like clouds or dust. */
export function warpedFbmAt(x: number, y: number, seed: number, strength = 0.5, octaves = 5): number {
  const qx = fbmAt(x + 1.7, y + 9.2, seed + 1, 4);
  const qy = fbmAt(x + 8.3, y + 2.8, seed + 2, 4);
  return fbmAt(x + strength * (2 * qx - 1), y + strength * (2 * qy - 1), seed, octaves);
}

/** Cellular noise: distances to the first, second and third nearest feature points, written into `out`. */
export function worleyAt(x: number, y: number, seed: number, jitter: number, out: Float64Array): void {
  const ix0 = Math.floor(x);
  const iy0 = Math.floor(y);
  let f1 = Infinity;
  let f2 = Infinity;
  let f3 = Infinity;
  const margin = (1 - jitter) / 2;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix0 + dx;
      const cy = iy0 + dy;
      const px = cx + margin + jitter * hash2(cx, cy, seed);
      const py = cy + margin + jitter * hash2(cx, cy, seed + 1);
      const ex = x - px;
      const ey = y - py;
      const d = Math.sqrt(ex * ex + ey * ey);
      f3 = d < f2 ? f2 : Math.min(f3, d);
      f2 = d < f1 ? f1 : Math.min(f2, d);
      f1 = Math.min(f1, d);
    }
  }
  out[0] = f1;
  out[1] = f2;
  out[2] = f3;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

// Array versions, as in noise.py.
export function valueNoise(x: Float64Array, y: Float64Array, seed: number): Float64Array {
  return x.map((xi, k) => valueNoiseAt(xi, y[k]!, seed));
}

export function fbm(x: Float64Array, y: Float64Array, seed: number, octaves = 5, lacunarity = 2.03, gain = 0.5): Float64Array {
  return x.map((xi, k) => fbmAt(xi, y[k]!, seed, octaves, lacunarity, gain));
}

export function warpedFbm(x: Float64Array, y: Float64Array, seed: number, strength = 0.5, octaves = 5): Float64Array {
  return x.map((xi, k) => warpedFbmAt(xi, y[k]!, seed, strength, octaves));
}

export function worley(x: Float64Array, y: Float64Array, seed: number, jitter = 0.8): [Float64Array, Float64Array, Float64Array] {
  const f1 = new Float64Array(x.length);
  const f2 = new Float64Array(x.length);
  const f3 = new Float64Array(x.length);
  const out = new Float64Array(3);
  for (let k = 0; k < x.length; k++) {
    worleyAt(x[k]!, y[k]!, seed, jitter, out);
    f1[k] = out[0]!;
    f2[k] = out[1]!;
    f3[k] = out[2]!;
  }
  return [f1, f2, f3];
}
