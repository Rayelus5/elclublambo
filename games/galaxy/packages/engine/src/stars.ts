import { blackbodyLinear, type Palette } from './color';
import type { Generator } from './rng/generator';

// stars.py (ENGINE_PORT §5.6): background stars, resolved stars inside the galaxy and bright cross-shaped glints.
// Every random array is drawn in full (row-major), whatever the probabilities: that is what keeps the stream in
// step with numpy. Colours are only computed where a star is on (the others are never read).
const fr = Math.fround;

export interface StarLayer {
  /** Dots that are forced on. */
  mask: Uint8Array;
  /** Linear (HDR) colour of those dots, float32, n × 3. */
  color: Float32Array;
}

export function backgroundStars(n: number, probability: number, palette: Palette, rng: Generator): StarLayer {
  const pick = rng.randomArray(n);
  const bright = rng.randomArray(n);
  const temperature = rng.uniformArray(3200, 14000, n);
  const mix = Math.min(1.0, palette.blackbodyMix * 2);
  const keep = fr(1 - mix);
  const mixF = fr(mix);
  const base = palette.sample(0.85).map((s) => fr(s * keep));
  const mask = new Uint8Array(n);
  const color = new Float32Array(3 * n);
  for (let k = 0; k < n; k++) {
    if (!(pick[k]! < probability)) continue;
    mask[k] = 1;
    const brightness = 0.35 + 0.9 * Math.pow(bright[k]!, 6); // almost all faint, very few bright
    const bb = blackbodyLinear(temperature[k]!);
    for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = fr(fr(base[ch]! + fr(bb[ch]! * mixF)) * brightness);
  }
  return { mask, color };
}

/** Resolved stars: more in dense areas; blue in the young arms, reddish in the bulge. */
export function galaxyStars(t: Float64Array, young: Float64Array, probability: number, palette: Palette, rng: Generator): StarLayer {
  const n = t.length;
  const pick = rng.randomArray(n);
  const tempJitter = rng.uniformArray(0, 1500, n);
  const bright = rng.randomArray(n);
  const detail = palette.detail !== null && palette.detailStars > 0 ? palette.detail : null;
  const detailPick = detail ? rng.randomArray(n) : null;
  const keep = fr(1 - palette.blackbodyMix);
  const mixF = fr(palette.blackbodyMix);
  const detailColor = detail ? detail.map((d) => fr(d * fr(0.85))) : null;
  const mask = new Uint8Array(n);
  const color = new Float32Array(3 * n);
  const c = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const tk = t[k]!;
    const p = probability * Math.pow(Math.min(Math.max(tk * 2.2, 0), 1), 1.2);
    if (!(pick[k]! < p && tk < 0.85)) continue;
    mask[k] = 1;
    if (detailColor && detailPick![k]! < palette.detailStars) {
      // Some resolved stars take the palette's secondary colour.
      c[0] = detailColor[0]!;
      c[1] = detailColor[1]!;
      c[2] = detailColor[2]!;
    } else {
      const temperature = 3300 + young[k]! * 15000 + tempJitter[k]!;
      const base = palette.sample(Math.min(Math.max(tk + 0.3, 0), 1));
      const bb = blackbodyLinear(temperature);
      for (let ch = 0; ch < 3; ch++) c[ch] = fr(fr(base[ch]! * keep) + fr(bb[ch]! * mixF));
    }
    const brightness = 1.1 + 0.8 * bright[k]!;
    for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = fr(c[ch]! * brightness);
  }
  return { mask, color };
}

export type Glint = [row: number, col: number, big: boolean];

/** Positions of the bright stars (row, column, big): most of them on the galaxy, some off it. */
export function glintCenters(t: Float64Array, nx: number, count: number, rng: Generator, margin = 3): Glint[] {
  const ny = t.length / nx;
  const onGalaxy: number[] = [];
  const offGalaxy: number[] = [];
  for (let j = margin; j < ny - margin; j++) {
    for (let i = margin; i < nx - margin; i++) {
      const k = j * nx + i;
      const tk = t[k]!;
      if (tk > 0.12 && tk < 0.65) onGalaxy.push(k);
      if (tk < 0.03) offGalaxy.push(k);
    }
  }
  const picks: number[] = [];
  const nBg = Math.max(1, Math.floor(count / 4));
  for (const [pool, want] of [
    [onGalaxy, count - nBg],
    [offGalaxy, nBg],
  ] as const) {
    if (pool.length && want > 0) {
      const chosen = rng.sampleWithoutReplacement(pool, Math.min(want, pool.length));
      picks.push(...chosen.sort((a, b) => a - b));
    }
  }
  return picks.map((k) => [Math.floor(k / nx), k % nx, rng.random() < 0.3]);
}
