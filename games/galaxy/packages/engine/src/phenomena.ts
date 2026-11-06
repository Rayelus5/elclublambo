import type { Palette, Rgb } from './color';
import type { PhenomenonVisual, Range } from './config/types';
import { galaxyParams, makeFrame, type GalaxyParams } from './geometry/common';
import { componentCenters } from './geometry/merger';
import { spiralWith } from './geometry/spiral';
import { fbmAt, smoothstep, warpedFbmAt } from './noise';
import type { BrailleGrid } from './raster';
import type { Generator } from './rng/generator';

// phenomena.py (ENGINE_PORT §5.7). Three classes, drawn with the same braille dots as the galaxy:
// - matter added to the galaxy, in its palette: satellite galaxy and globular clusters;
// - their own light, with their colour: supernova, comet, relativistic jets, pulsar and Einstein ring;
// - Anomaly: a terminal fault that corrupts the already dithered dot grid (and so the braille text).
// The random numbers of the "phenomenon" stream are drawn in Python's evaluation order; colours follow numpy 2's
// float32 rules (see background.ts).
const fr = Math.fround;
const TWO_PI = 2 * Math.PI;
const SQRT2 = Math.sqrt(2);
const WHITE: Rgb = [1, 1, 1];
// Python's scalar 0.8 ** k (UCRT pow), k = 1…6: the falloff of the pulsar rings.
const RING_FALLOFF = [0.8, 0.6400000000000001, 0.5120000000000001, 0.4096000000000001, 0.3276800000000001, 0.2621440000000001];

export interface LightLayer {
  /** Density of the phenomenon's light in [0, 1], float32. */
  t: Float32Array;
  /** Linear HDR colour, float32, n × 3. */
  color: Float32Array;
}

type Matter = { d: Float64Array; young: Float64Array };
const range = (spec: PhenomenonVisual, key: string) => spec[key] as Range;
const num = (spec: PhenomenonVisual, key: string) => spec[key] as number;
const hypot = (x: number, y: number) => Math.sqrt(x * x + y * y);

// ---------- positions ----------

/** Screen position of a point of the galaxy disk (radius in galaxy units). */
export function diskPoint(p: GalaxyParams, r: number, phi: number): [number, number] {
  const x = r * Math.cos(phi);
  const y = r * Math.sin(phi) * p.tilt;
  const ca = Math.cos(p.angle);
  const sa = Math.sin(p.angle);
  return [p.cx + p.size * (ca * x - sa * y), p.cy + p.size * (sa * x + ca * y)];
}

/** Screen position of the core (for a merger, the main galaxy's). */
export function corePoint(p: GalaxyParams): [number, number] {
  if (p.type === 'merger') return componentCenters(p)[0];
  const [ox, oy] = p.core_offset;
  const ys = oy * Math.max(p.tilt, 0.65); // the bulge flattens less than the disk (makeFrame)
  const ca = Math.cos(p.angle);
  const sa = Math.sin(p.angle);
  return [p.cx + p.size * (ca * ox - sa * ys), p.cy + p.size * (sa * ox + ca * ys)];
}

/** A point of the field around the galaxy: (u, v, angle). */
function fieldPoint(p: GalaxyParams, distance: Range, rng: Generator): [number, number, number] {
  const rho = rng.uniform(distance[0], distance[1]);
  const theta = rng.uniform(0, TWO_PI);
  return [p.cx + rho * Math.cos(theta), p.cy + rho * Math.sin(theta), theta];
}

/** Diffraction-spike cross, one dot wide. */
function cross(a: number, b: number, length: number, width: number): number {
  const qb = b / width;
  const qa = a / width;
  return Math.exp((-3 * Math.abs(a)) / length) * Math.exp(-(qb * qb)) + Math.exp((-3 * Math.abs(b)) / length) * Math.exp(-(qa * qa));
}

type Part = { intensity: Float64Array; rgb: readonly number[]; brightness: number };

/** Sum of components (intensity, colour, brightness): dot density and HDR colour per dot (`_compose`). */
function compose(n: number, parts: Part[]): { t: Float64Array; color: Float32Array } {
  const t = new Float64Array(n);
  const color = new Float32Array(3 * n);
  for (const { intensity, rgb, brightness } of parts) {
    const b = fr(brightness);
    const c0 = fr(rgb[0]! * b);
    const c1 = fr(rgb[1]! * b);
    const c2 = fr(rgb[2]! * b);
    for (let k = 0; k < n; k++) {
      const i = intensity[k]!;
      t[k] = t[k]! + i;
      color[3 * k] = color[3 * k]! + fr(i * c0);
      color[3 * k + 1] = color[3 * k + 1]! + fr(i * c1);
      color[3 * k + 2] = color[3 * k + 2]! + fr(i * c2);
    }
  }
  for (let k = 0; k < n; k++) t[k] = Math.min(Math.max(t[k]!, 0), 1);
  return { t, color };
}

/** accent·(1 − white) + white, in float32. */
function tint(palette: Palette, white: number): Rgb {
  const keep = fr(1 - white);
  const w = fr(white);
  return palette.accent.map((a) => fr(fr(a * keep) + w)) as Rgb;
}

// ---------- matter added to the galaxy ----------

/** Density and young population added to the galaxy's, or null when the phenomenon adds no matter. */
export function galaxyMatter(
  kind: string,
  u: Float64Array,
  v: Float64Array,
  p: GalaxyParams,
  spec: PhenomenonVisual,
  rng: Generator,
  seed: number,
): Matter | null {
  if (kind === 'satellite_galaxy') return satellite(u, v, p, spec, rng, seed);
  if (kind === 'globular_cluster') return globularClusters(u, v, p, spec, rng);
  return null;
}

function satellite(u: Float64Array, v: Float64Array, p: GalaxyParams, spec: PhenomenonVisual, rng: Generator, seed: number): Matter {
  const [sx, sy] = fieldPoint(p, range(spec, 'distance'), rng);
  const [s0, s1] = range(spec, 'size');
  const size = rng.uniform(s0, s1);
  const angle = rng.uniform(0, Math.PI);
  const tilt = rng.uniform(0.55, 1.0);
  const f = makeFrame(u, v, sx, sy, size, angle, tilt);
  const n = u.length;
  let d: Float64Array;
  let young: Float64Array;
  if (rng.random() < num(spec, 'spiral_share')) {
    const sp = galaxyParams({
      type: 'spiral',
      size,
      angle: 0.0,
      tilt: 1.0,
      arms: 2,
      pitch: rng.uniform(0.3, 0.45),
      arm_sharpness: 2.5,
      arm_amp: 1.3,
      interarm: 0.25,
      arm_warp: 0.5,
      dust: 0.2,
      disk_scale: 0.35,
    });
    ({ d, young } = spiralWith(f, sp, seed, false));
  } else {
    d = new Float64Array(n);
    young = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const w = warpedFbmAt(f.x[k]! * 2.2 + 7.0, f.y[k]! * 2.2, seed, 0.6, 4);
      const q = f.r[k]! / 0.5;
      const q6 = f.r[k]! / 0.6;
      d[k] = 0.9 * Math.exp(-(q * q)) * (0.5 + 0.9 * w);
      young[k] = smoothstep(0.55, 0.8, w) * Math.exp(-(q6 * q6));
    }
  }
  const amplitude = num(spec, 'amplitude');
  for (let k = 0; k < n; k++) {
    const r = f.r[k]!;
    const q = r / 0.09;
    d[k] = amplitude * ((d[k]! + 0.9 * Math.exp(-(q * q))) * (1 - smoothstep(0.85, 1.05, r)));
  }
  return { d, young };
}

/** Dense spherical clusters in the halo: the halo is spherical, so they are not projected onto the disk. */
function globularClusters(u: Float64Array, v: Float64Array, p: GalaxyParams, spec: PhenomenonVisual, rng: Generator): Matter {
  const n = u.length;
  const d = new Float64Array(n);
  const [c0, c1] = range(spec, 'count');
  const [dlo, dhi] = range(spec, 'distance');
  const [rlo, rhi] = range(spec, 'radius');
  const count = rng.integers(c0, c1 + 1);
  for (let g = 0; g < count; g++) {
    const rho = Math.min(p.size * rng.uniform(dlo, dhi), 0.84);
    const theta = rng.uniform(0, TWO_PI);
    const rc = rng.uniform(rlo, rhi);
    const ox = rho * Math.cos(theta);
    const oy = rho * Math.sin(theta);
    for (let k = 0; k < n; k++) {
      const r = hypot(u[k]! - p.cx - ox, v[k]! - p.cy - oy);
      const a = r / rc;
      const b = r / (3.5 * rc);
      d[k] = d[k]! + (2.4 * Math.exp(-(a * a)) + 0.35 * Math.exp(-(b * b)));
    }
  }
  return { d, young: new Float64Array(n) };
}

// ---------- their own light ----------

type Builder = (u: Float64Array, v: Float64Array, p: GalaxyParams, palette: Palette, spec: PhenomenonVisual, rng: Generator, grid: BrailleGrid, seed: number) => { t: Float64Array; color: Float32Array };

export function lightLayer(
  kind: string,
  u: Float64Array,
  v: Float64Array,
  p: GalaxyParams,
  palette: Palette,
  spec: PhenomenonVisual,
  rng: Generator,
  grid: BrailleGrid,
  seed: number,
): LightLayer | null {
  const builder = BUILDERS[kind];
  if (!builder) return null;
  const { t, color } = builder(u, v, p, palette, spec, rng, grid, seed);
  const n = u.length;
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    // Nothing touches the edge of the canvas.
    const edge = 1 - smoothstep(0.88, 1.0, hypot(u[k]!, v[k]!));
    out[k] = Math.min(Math.max(t[k]! * edge, 0), 1);
  }
  if (palette.inverted) {
    // On paper, the phenomena are printed in the accent ink.
    for (let k = 0; k < n; k++) color.set(palette.accent, 3 * k);
  }
  return { t: out, color };
}

function fill(n: number, f: (k: number) => number): Float64Array {
  const a = new Float64Array(n);
  for (let k = 0; k < n; k++) a[k] = f(k);
  return a;
}

/** A star that dominates the image: white core, diffraction spikes, halo and an expanding shell. */
const supernova: Builder = (u, v, p, palette, spec, rng, grid) => {
  const [dlo, dhi] = range(spec, 'distance');
  const r0 = rng.uniform(dlo, dhi);
  const phi = rng.uniform(0, TWO_PI);
  const [sx, sy] = grid.snap(...diskPoint(p, r0, phi));
  const step = grid.uvStep;
  const [l0, l1] = range(spec, 'spike_length');
  const length = rng.uniform(l0, l1);
  const [h0, h1] = range(spec, 'shell_radius');
  const shell = rng.uniform(h0, h1);
  const t04 = tint(palette, 0.4);
  const n = u.length;
  const du = fill(n, (k) => u[k]! - sx);
  const dv = fill(n, (k) => v[k]! - sy);
  const r = fill(n, (k) => hypot(du[k]!, dv[k]!));
  const sq = (x: number) => x * x;
  return compose(n, [
    { intensity: fill(n, (k) => Math.exp(-sq(r[k]! / (1.6 * step)))), rgb: WHITE, brightness: num(spec, 'brightness') },
    { intensity: fill(n, (k) => 0.9 * cross(du[k]!, dv[k]!, length, 0.6 * step)), rgb: t04, brightness: 2.2 },
    {
      intensity: fill(n, (k) => 0.55 * cross((du[k]! + dv[k]!) / SQRT2, (du[k]! - dv[k]!) / SQRT2, 0.4 * length, 0.6 * step)),
      rgb: t04,
      brightness: 1.6,
    },
    { intensity: fill(n, (k) => 0.7 * Math.exp(-sq(r[k]! / 0.055))), rgb: t04, brightness: 1.2 },
    { intensity: fill(n, (k) => 0.6 * Math.exp(-sq((r[k]! - shell) / (0.9 * step)))), rgb: palette.accent, brightness: 1.5 },
  ]);
};

/** A comet in the foreground: bright head, straight ion tail and curved dust tail. */
const comet: Builder = (u, v, p, palette, spec, rng, grid) => {
  const [hx, hy, theta] = fieldPoint(p, range(spec, 'distance'), rng);
  // The tail runs tangent to the edge: it crosses the image without leaving the canvas.
  const side = rng.sign();
  const direction = theta + side * (Math.PI / 2 + rng.uniform(-0.35, 0.35));
  const [l0, l1] = range(spec, 'length');
  const length = rng.uniform(l0, l1);
  const curve = rng.uniform(0.08, 0.18) * rng.sign();
  const c = Math.cos(direction);
  const s = Math.sin(direction);
  const n = u.length;
  const ion = new Float64Array(n);
  const dust = new Float64Array(n);
  const head = new Float64Array(n);
  const glow = new Float64Array(n);
  const step = grid.uvStep;
  for (let k = 0; k < n; k++) {
    const du = u[k]! - hx;
    const dv = v[k]! - hy;
    const sk = du * c + dv * s;
    const nk = -du * s + dv * c;
    const a = Math.min(Math.max(sk / length, 0.0), 1.0);
    const behind = sk > 0 ? 1 : 0;
    const qi = nk / (0.005 + 0.022 * a);
    ion[k] = Math.exp(-(qi * qi)) * Math.pow(1 - a, 0.6) * behind;
    const qd = (nk - curve * length * (a * a)) / (0.012 + 0.09 * a);
    dust[k] = 0.9 * (Math.exp(-(qd * qd)) * Math.pow(1 - a, 0.9) * behind);
    const r = hypot(du, dv);
    const qh = r / (1.8 * step);
    const qg = r / 0.026;
    head[k] = Math.exp(-(qh * qh));
    glow[k] = 0.9 * Math.exp(-(qg * qg));
  }
  return compose(n, [
    { intensity: head, rgb: WHITE, brightness: 6.0 },
    { intensity: glow, rgb: tint(palette, 0.5), brightness: 1.8 },
    { intensity: ion, rgb: palette.accent, brightness: 1.6 },
    { intensity: dust, rgb: palette.sample(0.85), brightness: 1.3 },
  ]);
};

/** Two jets out of the core along the minor axis, with knots and lobes at the ends. */
const jets: Builder = (u, v, p, palette, spec, rng, grid, seed) => {
  const [cx, cy] = corePoint(p);
  const direction = p.angle + Math.PI / 2 + rng.uniform(-0.35, 0.35);
  const [l0, l1] = range(spec, 'length');
  const length = rng.uniform(l0, l1);
  const [b0, b1] = range(spec, 'lobe_radius');
  const lobeR = rng.uniform(b0, b1);
  const knots = rng.uniformArray(0.15, 0.85, rng.integers(3, 6));
  const c = Math.cos(direction);
  const s = Math.sin(direction);
  const step = grid.uvStep;
  const n = u.length;
  const beams = new Float64Array(n);
  const lobes = new Float64Array(n);
  const spots = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const du = u[k]! - cx;
    const dv = v[k]! - cy;
    const s0 = du * c + dv * s;
    const nk = -du * s + dv * c;
    const lumps = fbmAt(u[k]! * 9.0, v[k]! * 9.0, seed, 3);
    let beam = 0;
    let lobe = 0;
    let spot = 0;
    // The counter-jet looks fainter.
    for (const [sign, power] of [
      [1, 1.0],
      [-1, 0.6],
    ] as const) {
      const sk = sign * s0;
      const a = sk / length;
      const inside = a > 0.02 && a < 1.0 ? 1 : 0;
      let sum = 0;
      for (const kn of knots) {
        const q = (a - kn) / 0.04;
        sum += 0.45 * Math.exp(-(q * q));
      }
      const knot = Math.min(1.0, 0.55 + sum);
      const qb = nk / (step * (0.6 + 1.2 * a));
      beam += power * Math.exp(-(qb * qb)) * inside * knot * (1 - 0.4 * a);
      const end = hypot(sk - length, nk);
      const ql = end / lobeR;
      const qs = end / (1.5 * step);
      lobe += power * Math.exp(-(ql * ql)) * (0.5 + 0.8 * lumps);
      spot += power * Math.exp(-(qs * qs));
    }
    beams[k] = beam;
    lobes[k] = 0.55 * lobe;
    spots[k] = spot;
  }
  return compose(n, [
    { intensity: beams, rgb: tint(palette, 0.5), brightness: 2.6 },
    { intensity: lobes, rgb: palette.accent, brightness: 1.2 },
    { intensity: spots, rgb: WHITE, brightness: 3.5 },
  ]);
};

/** A neutron star: two opposite beams and concentric pulses. */
const pulsar: Builder = (u, v, p, palette, spec, rng, grid) => {
  const [fx, fy] = fieldPoint(p, range(spec, 'distance'), rng);
  const [px, py] = grid.snap(fx, fy);
  const step = grid.uvStep;
  const axis = rng.uniform(0, Math.PI);
  const opening = rng.uniform(0.06, 0.1);
  const [l0, l1] = range(spec, 'beam_length');
  const length = rng.uniform(l0, l1);
  const [g0, g1] = range(spec, 'ring_spacing');
  const spacing = rng.uniform(g0, g1);
  const [n0, n1] = range(spec, 'rings');
  const rings = rng.integers(n0, n1 + 1);
  const c = Math.cos(axis);
  const s = Math.sin(axis);
  const n = u.length;
  const core = new Float64Array(n);
  const beams = new Float64Array(n);
  const pulses = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const du = u[k]! - px;
    const dv = v[k]! - py;
    const r = hypot(du, dv);
    const s0 = du * c + dv * s;
    const nk = -du * s + dv * c;
    let beam = 0;
    for (const sk of [s0, -s0]) {
      const q = nk / (opening * sk + 0.7 * step);
      beam += Math.exp(-(q * q)) * (sk > 0 ? 1 : 0) * Math.exp((-2.5 * sk) / length);
    }
    let ring = 0;
    for (let i = 1; i <= rings; i++) {
      const q = (r - spacing * i) / (0.7 * step);
      ring += RING_FALLOFF[i - 1]! * Math.exp(-(q * q));
    }
    const qc = r / (1.5 * step);
    core[k] = Math.exp(-(qc * qc));
    beams[k] = beam;
    pulses[k] = 0.75 * ring;
  }
  return compose(n, [
    { intensity: core, rgb: WHITE, brightness: 6.0 },
    { intensity: beams, rgb: tint(palette, 0.4), brightness: 2.6 },
    { intensity: pulses, rgb: palette.accent, brightness: 1.4 },
  ]);
};

/** The light of a background galaxy, bent by this one's mass into a ring with brighter arcs. */
const einsteinRing: Builder = (u, v, p, palette, spec, rng) => {
  const [cx, cy] = corePoint(p);
  const [r0, r1] = range(spec, 'radius');
  const radius = p.size * rng.uniform(r0, r1);
  const axis = rng.uniform(0, Math.PI);
  const squash = rng.uniform(0.85, 1.0); // a slightly elliptical ring
  const [a0, a1] = range(spec, 'arcs');
  const count = rng.integers(a0, a1 + 1);
  const base = rng.uniform(0, TWO_PI);
  const jitter = rng.uniformArray(-0.3, 0.3, count);
  const centers = Array.from({ length: count }, (_, i) => base + (TWO_PI * i) / count + jitter[i]!);
  const width = num(spec, 'width');
  const c = Math.cos(axis);
  const s = Math.sin(axis);
  const n = u.length;
  const ring = new Float64Array(n);
  const halo = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const du = u[k]! - cx;
    const dv = v[k]! - cy;
    const sk = du * c + dv * s;
    const nk = (-du * s + dv * c) / squash;
    const rho = hypot(sk, nk);
    const angle = Math.atan2(nk, sk);
    let near = 0;
    for (const ck of centers) {
      let m = (angle - ck + Math.PI) % TWO_PI;
      if (m < 0) m += TWO_PI; // numpy's mod has the sign of the divisor
      const q = (m - Math.PI) / 0.45;
      near += Math.exp(-(q * q));
    }
    const arcs = 0.35 + 0.65 * Math.min(near, 1.0);
    const qa = (rho - radius) / width;
    const qb = (rho - radius) / (3 * width);
    ring[k] = Math.exp(-(qa * qa)) * arcs;
    halo[k] = 0.25 * Math.exp(-(qb * qb)) * arcs;
  }
  return compose(n, [
    { intensity: ring, rgb: tint(palette, 0.35), brightness: 2.4 },
    { intensity: halo, rgb: palette.accent, brightness: 0.8 },
  ]);
};

const BUILDERS: Readonly<Record<string, Builder>> = {
  supernova,
  comet,
  relativistic_jets: jets,
  pulsar,
  einstein_ring: einsteinRing,
};

// ---------- Anomaly ----------

/**
 * The terminal fails: shifted bands, blocks of corrupt cells and rows without signal. Works on the dithered grid,
 * always in whole braille cells (2×4 dots), so the exported text is corrupted like the image. Edits in place; the
 * slices are clipped to the grid like numpy's, and the random block fill draws one number per clipped dot.
 */
export function glitch(
  on: Uint8Array,
  color: Float32Array,
  radius: Float32Array,
  nx: number,
  ny: number,
  palette: Palette,
  spec: PhenomenonVisual,
  rng: Generator,
  dotRadius: number,
): void {
  const rows = Math.floor(ny / 4);
  const cols = Math.floor(nx / 2);
  const accent = palette.inverted ? palette.accent : palette.accent.map((a) => fr(fr(a * 2.0) + fr(0.3)));
  const dotR = fr(dotRadius);

  const [band0, band1] = range(spec, 'bands');
  const bands = rng.integers(band0, band1 + 1);
  const rowOn = new Uint8Array(nx);
  const rowColor = new Float32Array(3 * nx);
  const rowRadius = new Float32Array(nx);
  for (let b = 0; b < bands; b++) {
    const r0 = rng.integers(0, rows);
    const h = rng.integers(1, 7);
    const shift = 2 * rng.integers(3, 30) * rng.sign();
    const yEnd = Math.min(ny, 4 * (r0 + h));
    for (let y = 4 * r0; y < yEnd; y++) {
      // np.roll along x: rolled[x] = row[(x − shift) mod nx], wrapping around the full width.
      const base = y * nx;
      rowOn.set(on.subarray(base, base + nx));
      rowColor.set(color.subarray(3 * base, 3 * (base + nx)));
      rowRadius.set(radius.subarray(base, base + nx));
      for (let x = 0; x < nx; x++) {
        let src = (x - shift) % nx;
        if (src < 0) src += nx;
        on[base + x] = rowOn[src]!;
        radius[base + x] = rowRadius[src]!;
        color[3 * (base + x)] = rowColor[3 * src]!;
        color[3 * (base + x) + 1] = rowColor[3 * src + 1]!;
        color[3 * (base + x) + 2] = rowColor[3 * src + 2]!;
      }
    }
    if (rng.random() < 0.5) {
      // Crossed colour channels.
      for (let k = 4 * r0 * nx; k < yEnd * nx; k++) {
        const red = color[3 * k]!;
        color[3 * k] = color[3 * k + 2]!;
        color[3 * k + 2] = red;
      }
    }
  }

  const [block0, block1] = range(spec, 'blocks');
  const blocks = rng.integers(block0, block1 + 1);
  for (let b = 0; b < blocks; b++) {
    const r0 = rng.integers(0, rows);
    const c0 = rng.integers(0, cols);
    const h = rng.integers(1, 4);
    const w = rng.integers(4, 20);
    const yEnd = Math.min(ny, 4 * (r0 + h));
    const xEnd = Math.min(nx, 2 * (c0 + w));
    const noise = rng.randomArray((yEnd - 4 * r0) * (xEnd - 2 * c0));
    let q = 0;
    for (let y = 4 * r0; y < yEnd; y++) {
      for (let x = 2 * c0; x < xEnd; x++) {
        const k = y * nx + x;
        on[k] = noise[q++]! < 0.6 ? 1 : 0;
        color.set(accent, 3 * k);
        radius[k] = dotR;
      }
    }
  }

  const lost = rng.integers(1, 4);
  for (let l = 0; l < lost; l++) {
    const r0 = rng.integers(0, rows);
    on.fill(0, 4 * r0 * nx, Math.min(ny, 4 * r0 + 4) * nx); // loss of signal
  }

  // A desynchronised scan line.
  const row = rng.integers(0, ny);
  const line = rng.randomArray(nx);
  const scan = accent.map((a) => fr(a * fr(0.6)));
  for (let x = 0; x < nx; x++) {
    if (!(line[x]! < 0.7)) continue;
    const k = row * nx + x;
    on[k] = 1;
    color.set(scan, 3 * k);
    radius[k] = dotR;
  }
}
