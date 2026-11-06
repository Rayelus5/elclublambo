import type { CoreVisual } from '../config/types';

// geometry/common.py (ENGINE_PORT §5.1): what a galaxy is, in numbers, and the frame of each dot relative to it.
// Field names stay snake_case, as in GalaxyParams, so the golden params compare key for key.

export type Knot = [kx: number, ky: number, radius: number, amp: number];
export type Burst = [path: number, pos: number, amp: number, radius: number];

export interface EllipticalExtra {
  amp: number;
  k: number;
  exp: number;
  shells: Array<[radius: number, phase: number]>;
}
export interface LenticularExtra {
  lens_radius: number;
  ring_amp: number;
  ring_radius: number;
}
export interface RingExtra {
  radius: number;
  width: number;
  amp: number;
  spokes: number;
  spoke_amp: number;
}
export interface IrregularExtra {
  ox: number;
  oy: number;
  env_dx: number;
  env_dy: number;
  env_radius: number;
  knots: Knot[];
  kind: 'irregular' | 'spheroidal';
}
export interface MergerExtra {
  a_offset: [number, number];
  b_offset: [number, number];
  a_scale: number;
  b_scale: number;
  a_angle: number;
  b_angle: number;
  b_tilt: number;
  a_pitch: number;
  b_pitch: number;
  b_kind: 'elliptical' | 'spiral';
  b_amp: number;
  tail_a_angle: number;
  tail_sweep: number;
  tail_length: number;
  bursts: Burst[];
}
export type GalaxyExtra =
  | EllipticalExtra
  | LenticularExtra
  | RingExtra
  | IrregularExtra
  | MergerExtra
  | Record<string, never>;

export interface GalaxyParams {
  type: string;
  /** Radius on screen (1 = edge of the canvas). */
  size: number;
  /** Position angle of the major axis (rad). */
  angle: number;
  /** Axis ratio of the disk (1 = face on). */
  tilt: number;
  cx: number;
  cy: number;
  arms: number;
  gain: number;
  noise_seed: number;
  disk_scale: number;
  pitch: number;
  arm_sharpness: number;
  arm_amp: number;
  interarm: number;
  arm_warp: number;
  dust: number;
  dust_offset: number;
  bar_length: number;
  bar_width: number;
  bar_amp: number;
  core_kind: string;
  core: CoreVisual | Record<string, never>;
  core_scale: number;
  core_dir: number;
  core_offset: [number, number];
  extra: GalaxyExtra;
}

/** GalaxyParams with the dataclass defaults. */
export function galaxyParams(fields: Pick<GalaxyParams, 'type' | 'size' | 'angle' | 'tilt'> & Partial<GalaxyParams>): GalaxyParams {
  return {
    cx: 0.0,
    cy: 0.0,
    arms: 0,
    gain: 1.0,
    noise_seed: 0,
    disk_scale: 0.32,
    pitch: 0.3,
    arm_sharpness: 3.0,
    arm_amp: 1.3,
    interarm: 0.15,
    arm_warp: 0.4,
    dust: 0.5,
    dust_offset: 0.7,
    bar_length: 0.25,
    bar_width: 0.05,
    bar_amp: 0.85,
    core_kind: 'bright',
    core: {},
    core_scale: 1.0,
    core_dir: 0.0,
    core_offset: [0.0, 0.0],
    extra: {},
    ...fields,
  };
}

/** Coordinates of each dot relative to the galaxy, in galaxy units (visible radius ≈ 1). */
export interface Frame {
  /** Major axis of the disk. */
  x: Float64Array;
  /** Minor axis, de-projected (undoes the inclination). */
  y: Float64Array;
  r: Float64Array;
  th: Float64Array;
  /** Minor axis for the bulge, which flattens much less than the disk. */
  yb: Float64Array;
  rb: Float64Array;
  ys: Float64Array;
}

export function makeFrame(
  u: Float64Array,
  v: Float64Array,
  cx: number,
  cy: number,
  size: number,
  angle: number,
  tilt: number,
  bulgeTiltFloor = 0.65,
): Frame {
  const n = u.length;
  const f: Frame = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    r: new Float64Array(n),
    th: new Float64Array(n),
    yb: new Float64Array(n),
    rb: new Float64Array(n),
    ys: new Float64Array(n),
  };
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const bulgeTilt = Math.max(tilt, bulgeTiltFloor);
  for (let k = 0; k < n; k++) {
    const su = (u[k]! - cx) / size;
    const sv = (v[k]! - cy) / size;
    const xs = ca * su + sa * sv;
    const ys = -sa * su + ca * sv;
    const y = ys / tilt;
    const yb = ys / bulgeTilt;
    f.x[k] = xs;
    f.y[k] = y;
    f.r[k] = Math.sqrt(xs * xs + y * y);
    f.th[k] = Math.atan2(y, xs);
    f.yb[k] = yb;
    f.rb[k] = Math.sqrt(xs * xs + yb * yb);
    f.ys[k] = ys;
  }
  return f;
}

export function gaussianBlob(x: number, y: number, cx: number, cy: number, radius: number): number {
  const dx = x - cx;
  const dy = y - cy;
  return Math.exp(-(dx * dx + dy * dy) / (radius * radius));
}

/** A geometry turns a frame into (density, young population) per dot. */
export type Geometry = (f: Frame, p: GalaxyParams, seed: number) => { d: Float64Array; young: Float64Array };
