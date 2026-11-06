import { VISUALS } from './config/generated';
import type { CoreVisual, Range, Traits } from './config/types';
import { galaxyParams, makeFrame, type Burst, type Frame, type GalaxyParams, type Knot } from './geometry/common';
import { diskGeometry } from './geometry/index';
import { merger } from './geometry/merger';
import { smoothstep } from './noise';
import { subRng } from './rng/generator';
import { subSeed32 } from './rng/seed';

// fields.py (ENGINE_PORT §5.1, draw order §2.5): from the traits to the numbers of the galaxy. The "geometry" stream
// is consumed in Python's evaluation order — keyword arguments and list items left to right — so keep each call
// where it is, even when it looks reorderable.
const TWO_PI = 2 * Math.PI;

export function buildParams(traits: Traits, seed: bigint, center: readonly [number, number]): GalaxyParams {
  const rng = subRng(seed, 'geometry');
  const U = (lo: number, hi: number) => rng.uniform(lo, hi);
  const UR = ([lo, hi]: Range) => rng.uniform(lo, hi);
  const gtype = traits.galaxy_type;
  const size = UR(VISUALS.size[traits.size]!);
  const tilt = traits.inclination !== undefined ? UR(VISUALS.inclination[traits.inclination]!) : UR(VISUALS.shape[gtype]!);
  const p = galaxyParams({
    type: gtype,
    size: size * (gtype === 'dwarf' ? 0.88 : 1.0),
    angle: U(0, Math.PI),
    tilt,
    cx: center[0],
    cy: center[1],
    arms: traits.arms ? parseInt(traits.arms, 10) : 0,
    gain: VISUALS.star_density[traits.star_density]!.gain,
    noise_seed: subSeed32(seed, 'noise'),
    disk_scale: U(0.33, 0.43),
    pitch: U(0.2, 0.42),
    arm_sharpness: U(2.2, 4.5),
    arm_amp: U(1.1, 1.5),
    interarm: U(0.1, 0.2),
    arm_warp: U(0.25, 0.6),
    dust: U(0.35, 0.6),
    dust_offset: U(0.5, 0.9),
    core_kind: traits.core,
    core: { ...VISUALS.core[traits.core]! },
    core_scale: VISUALS.core_scale[gtype]!,
    core_dir: U(0, TWO_PI),
  });
  if (gtype === 'barred_spiral') {
    p.bar_length = U(0.2, 0.3);
    p.bar_width = U(0.04, 0.06);
    p.bar_amp = U(0.7, 1.0);
    p.pitch = U(0.25, 0.5);
  } else if (gtype === 'elliptical') {
    let shells: Array<[number, number]> = [];
    if (rng.random() < 0.35) {
      const count = rng.integers(2, 5);
      shells = Array.from({ length: count }, () => [U(0.35, 0.8), U(0, TWO_PI)] as [number, number]);
    }
    p.extra = { amp: U(2.0, 2.4), k: U(3.6, 4.2), exp: U(0.55, 0.68), shells };
  } else if (gtype === 'lenticular') {
    p.extra = { lens_radius: U(0.25, 0.4), ring_amp: U(0.0, 0.25), ring_radius: U(0.5, 0.65) };
  } else if (gtype === 'ring') {
    p.extra = { radius: U(0.55, 0.7), width: U(0.05, 0.08), amp: U(1.0, 1.4), spokes: rng.integers(5, 10), spoke_amp: U(0.04, 0.12) };
    p.core_offset = [U(-0.08, 0.08), U(-0.05, 0.05)];
  } else if (gtype === 'irregular' || gtype === 'dwarf') {
    const count = rng.integers(3, 8);
    const knots = Array.from({ length: count }, (): Knot => [U(-0.5, 0.5), U(-0.4, 0.4), U(0.03, 0.07), U(0.3, 0.9)]);
    const ox = U(-50, 50);
    const oy = U(-50, 50);
    const env_dx = U(-0.15, 0.15);
    const env_dy = U(-0.15, 0.15);
    const env_radius = U(0.38, 0.5);
    // `random()` is only drawn for dwarfs (Python's `or` short-circuits).
    const kind = gtype === 'irregular' || rng.random() < 0.4 ? 'irregular' : 'spheroidal';
    p.extra = { ox, oy, env_dx, env_dy, env_radius, knots, kind };
  } else if (gtype === 'merger') {
    const a_scale = U(0.58, 0.66);
    const b_scale = U(0.42, 0.52);
    const a_angle = U(-0.6, 0.6);
    const b_angle = U(0.8, 2.4);
    const b_tilt = U(0.4, 0.9);
    const a_pitch = U(0.3, 0.45);
    const b_pitch = U(0.3, 0.5);
    const b_kind = rng.random() < 0.35 ? 'elliptical' : 'spiral';
    const b_amp = U(0.8, 1.1);
    // Each tail leaves on the side opposite the other galaxy and curls: an S shape.
    const tail_a_angle = Math.PI + U(-0.5, 0.5);
    const tail_sweep = U(1.2, 1.9);
    const tail_length = U(0.6, 0.85);
    // Star bursts: (path 0 = tail A · 1 = tail B · 2 = bridge, position, brightness, radius).
    const count = rng.integers(6, 11);
    const bursts = Array.from({ length: count }, (): Burst => [rng.integers(0, 3), U(0.15, 0.85), U(0.5, 1.0), U(0.012, 0.022)]);
    p.extra = {
      a_offset: [-0.24, 0.05],
      b_offset: [0.26, -0.07],
      a_scale,
      b_scale,
      a_angle,
      b_angle,
      b_tilt,
      a_pitch,
      b_pitch,
      b_kind,
      b_amp,
      tail_a_angle,
      tail_sweep,
      tail_length,
      bursts,
    };
  }
  return p;
}

const DISK_TYPES = new Set(['spiral', 'barred_spiral', 'lenticular']);

export interface GalaxyField {
  /** Toned density in [0, 1]. */
  t: Float64Array;
  /** 0 = old population (reddish stars), 1 = young (bluish). */
  young: Float64Array;
  /** Angle and radius in the disk of the main galaxy. */
  theta: Float64Array;
  radius: Float64Array;
}

/** Density of the core (Core trait) at each dot, added in place to `d`. */
export function addCoreDensity(d: Float64Array, f: Frame, p: GalaxyParams): void {
  const c = p.core as CoreVisual;
  const amp = c.amplitude * p.core_scale;
  const rad = c.radius;
  const rad2 = rad * rad; // Python `rad ** 2` (UCRT pow) equals rad*rad for the YAML radii (ENGINE_PORT §8)
  const [ox, oy] = p.core_offset;
  const double = p.core_kind === 'double_nucleus';
  const quasar = p.core_kind === 'quasar';
  const half = double ? c.separation! / 2 : 0;
  const dx = half * Math.cos(p.core_dir);
  const dy = half * Math.sin(p.core_dir);
  for (let k = 0; k < d.length; k++) {
    const x = f.x[k]! - ox;
    const yb = f.yb[k]! - oy;
    let core: number;
    if (double) {
      const ax = x - dx;
      const ay = yb - dy;
      const bx = x + dx;
      const by = yb + dy;
      core = amp * (Math.exp(-(ax * ax + ay * ay) / rad2) + 0.85 * Math.exp(-(bx * bx + by * by) / rad2));
    } else {
      const rb = Math.sqrt(x * x + yb * yb);
      const q = rb / rad;
      core = amp * Math.exp(-(q * q)) + 0.35 * amp * Math.exp(-rb / (rad * 2.5));
    }
    if (quasar) {
      const q = Math.sqrt(x * x + yb * yb) / 0.012;
      core += c.point! * Math.exp(-(q * q));
    }
    d[k] = d[k]! + core;
  }
}

/** Diffraction spikes: four one-dot-wide lines out of the core, centred on (cx, cy) even for mergers. */
export function quasarSpike(u: number, v: number, p: GalaxyParams, length: number, width: number): number {
  const du = u - p.cx;
  const dv = v - p.cy;
  const a = dv / width;
  const b = du / width;
  return 2.0 * (Math.exp((-3 * Math.abs(du)) / length) * Math.exp(-(a * a)) + Math.exp((-3 * Math.abs(dv)) / length) * Math.exp(-(b * b)));
}

/**
 * Density field of the galaxy at each dot (u[k], v[k]). `extra` is (density, young) of matter a phenomenon adds
 * (satellite galaxy, globular clusters).
 */
export function galaxyField(
  u: Float64Array,
  v: Float64Array,
  p: GalaxyParams,
  densityGain: number,
  dotStep: number,
  extra?: { d: Float64Array; young: Float64Array } | null,
): GalaxyField {
  const seed = p.noise_seed;
  const n = u.length;
  let d: Float64Array;
  let young: Float64Array;
  let f: Frame;
  if (p.type === 'merger') {
    ({ d, young, frame: f } = merger(u, v, p, seed));
  } else {
    f = makeFrame(u, v, p.cx, p.cy, p.size, p.angle, p.tilt);
    ({ d, young } = diskGeometry(p.type)(f, p, seed));
    if (DISK_TYPES.has(p.type) && p.tilt < 0.3) {
      // Edge-on galaxy: a dark dust lane along the disk.
      const laneWidth = 0.03 + 0.04 * p.tilt;
      for (let k = 0; k < n; k++) {
        const q = f.ys[k]! / laneWidth;
        const lane = Math.exp(-(q * q));
        d[k] = d[k]! * (1 - 0.75 * lane * (0.4 + 0.6 * smoothstep(0.0, 0.12, Math.abs(f.x[k]!))));
      }
    }
  }
  addCoreDensity(d, f, p);
  const t = new Float64Array(n);
  const quasar = p.core_kind === 'quasar';
  const spikeLength = quasar ? (p.core as CoreVisual).spikes! * p.size : 0;
  const spikeWidth = dotStep * 0.65;
  for (let k = 0; k < n; k++) {
    let dk = d[k]!;
    if (extra) {
      dk = dk + extra.d[k]!;
      young[k] = young[k]! + extra.young[k]!;
    }
    if (quasar) dk += quasarSpike(u[k]!, v[k]!, p, spikeLength, spikeWidth);
    dk *= p.gain;
    const uk = u[k]!;
    const vk = v[k]!;
    dk *= 1 - smoothstep(0.9, 1.05, Math.sqrt(uk * uk + vk * vk)); // nothing touches the edge of the canvas
    t[k] = 1 - Math.exp(-densityGain * dk);
    young[k] = Math.min(Math.max(young[k]!, 0), 1);
  }
  return { t, young, theta: f.th, radius: f.r };
}
