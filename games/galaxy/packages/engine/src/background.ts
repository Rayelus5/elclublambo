import type { Palette } from './color';
import type { BackgroundVisual } from './config/types';
import { fbmAt, smoothstep, warpedFbmAt, worleyAt } from './noise';
import type { Generator } from './rng/generator';

// background.py (ENGINE_PORT §5.5): void, starfield, nebular dust, cosmic web and microwave background, all in dots.
//
// Colours follow numpy 2's promotion rules (NEP 50): a float32 palette colour times a Python float stays float32
// (both rounded to float32), times a float64 array becomes float64. `fr` marks every float32 rounding. The density
// `t` is float64 and is rounded to float32 once, at the end, before it decides any dot.
const fr = Math.fround;

export interface BackgroundField {
  t: Float32Array;
  /** Linear RGB per dot (n × 3), float32. */
  color: Float32Array;
}

export function backgroundField(
  u: Float64Array,
  v: Float64Array,
  kind: string,
  spec: BackgroundVisual,
  palette: Palette,
  seed: number,
  rng: Generator,
): BackgroundField {
  const n = u.length;
  const level = spec.level ?? 0.0;
  const brightness = fr(spec.brightness ?? 0.0);
  const t = new Float64Array(n);
  const color = new Float32Array(3 * n);
  const accent = palette.accent;
  const c = [0, 0, 0];

  if (kind === 'nebular_dust') {
    const acc = accent.map((a) => fr(a * fr(0.35)));
    for (let k = 0; k < n; k++) {
      const nz = warpedFbmAt(u[k]! * 1.1 + 4.0, v[k]! * 1.1 - 3.0, seed, 0.9, 6);
      t[k] = level * Math.pow(smoothstep(0.4, 0.8, nz), 1.2);
      const warm = smoothstep(0.5, 0.8, nz);
      const s = palette.sample(0.45 + 0.4 * nz);
      for (let ch = 0; ch < 3; ch++) c[ch] = s[ch]! * (1 - 0.35 * warm) + acc[ch]! * warm;
      for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = fr(fr(c[ch]!) * brightness);
    }
  } else if (kind === 'cosmic_web') {
    // A web of filaments: edges of warped Voronoi cells, with clusters where they cross.
    const acc = accent.map((a) => fr(a * fr(0.4)));
    const layers = [
      [1.7, 0.045, 1.0],
      [4.2, 0.04, 0.4],
    ] as const;
    const fs = new Float64Array(3);
    for (let k = 0; k < n; k++) {
      const uk = u[k]!;
      const vk = v[k]!;
      const wu = uk + 0.25 * (fbmAt(uk * 1.4 + 3.0, vk * 1.4, seed + 1, 4) - 0.5);
      const wv = vk + 0.25 * (fbmAt(uk * 1.4, vk * 1.4 - 3.0, seed + 2, 4) - 0.5);
      let web = 0;
      let nodes = 0;
      for (const [scale, width, amp] of layers) {
        const ks = seed + Math.trunc(scale * 10);
        worleyAt(wu * scale + 11.0, wv * scale - 7.0, ks, 0.8, fs);
        // Some filaments fade and others thicken: the web does not look like a regular honeycomb.
        const strength = amp * smoothstep(0.3, 0.62, fbmAt(uk * 1.3 + scale, vk * 1.3, ks + 5, 3));
        const w = width * (0.55 + 0.9 * fbmAt(uk * 2.5, vk * 2.5 + scale, ks + 6, 3));
        const qa = (fs[1]! - fs[0]!) / w;
        const qb = (fs[2]! - fs[0]!) / (w * 2);
        web = Math.max(web, strength * Math.exp(-(qa * qa)));
        nodes = Math.max(nodes, strength * Math.exp(-(qb * qb)));
      }
      // The filaments break into beads, like chains of galaxies.
      const beads = 0.15 + 1.1 * smoothstep(0.25, 0.75, fbmAt(uk * 8.0 + 5.0, vk * 8.0, seed + 3, 4));
      t[k] = level * Math.min(Math.max((0.7 * web + 0.5 * nodes) * beads, 0.0), 1.0);
      const hot = nodes;
      const s = palette.sample(0.55 + 0.3 * web);
      for (let ch = 0; ch < 3; ch++) c[ch] = s[ch]! * (1 + 1.6 * hot) * (1 - 0.4 * hot) + acc[ch]! * hot;
      for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = fr(fr(c[ch]!) * brightness);
    }
  } else if (kind === 'cmb') {
    const s = palette.sample(0.55);
    for (let k = 0; k < n; k++) {
      const nz = fbmAt(u[k]! * 2.4, v[k]! * 2.4, seed, 6);
      t[k] = level * (0.35 + 0.65 * nz);
      const warm = smoothstep(0.38, 0.62, nz);
      for (let ch = 0; ch < 3; ch++) c[ch] = s[ch]! * (1 - warm) + accent[ch]! * warm;
      for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = fr(fr(c[ch]!) * brightness);
    }
  }
  // Other kinds (deep_void, starfield): no texture; colour 0 × brightness stays 0.

  const distant = Math.trunc(spec.distant_galaxies ?? 0);
  if (distant > 0) {
    const far = palette.sample(0.7).map((x) => fr(x * fr(0.7)));
    for (let g = 0; g < distant; g++) {
      const cx = rng.uniform(-0.92, 0.92);
      const cy = rng.uniform(-0.92, 0.92);
      const a = rng.uniform(0.01, 0.022);
      const b = a * rng.uniform(0.35, 0.8);
      const ang = rng.uniform(0, Math.PI);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      for (let k = 0; k < n; k++) {
        const du = u[k]! - cx;
        const dv = v[k]! - cy;
        const x = du * cos + dv * sin;
        const y = -du * sin + dv * cos;
        const qx = x / a;
        const qy = y / b;
        const blob = 0.45 * Math.exp(-(qx * qx) - qy * qy);
        if (blob > t[k]!) {
          color[3 * k] = far[0]!;
          color[3 * k + 1] = far[1]!;
          color[3 * k + 2] = far[2]!;
          t[k] = blob;
        }
      }
    }
  }
  return { t: Float32Array.from(t), color };
}
