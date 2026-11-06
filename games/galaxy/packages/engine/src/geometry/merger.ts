import { fbmAt } from '../noise';
import { makeFrame, type Frame, type GalaxyParams, type MergerExtra } from './common';
import { elliptical } from './elliptical';
import { spiralWith } from './spiral';

// geometry/merger.py (ENGINE_PORT §5.3, §10.8): two interacting galaxies with tidal tails and a bridge of stars.
type Polyline = { px: Float64Array; py: Float64Array; widths: Float64Array; amps: Float64Array };

/** np.linspace(0, 1, n). */
function linspace01(n: number): Float64Array {
  const s = new Float64Array(n);
  const step = 1 / (n - 1);
  for (let k = 0; k < n; k++) s[k] = k === n - 1 ? 1 : k * step;
  return s;
}

function tail(origin: readonly [number, number], startAngle: number, sweep: number, length: number, size: number, ca: number, sa: number, steps = 140): Polyline {
  const s = linspace01(steps);
  const line: Polyline = {
    px: new Float64Array(steps),
    py: new Float64Array(steps),
    widths: new Float64Array(steps),
    amps: new Float64Array(steps),
  };
  for (let k = 0; k < steps; k++) {
    const sk = s[k]!;
    const rho = (0.12 + length * sk) * size;
    const phi = startAngle + sweep * sk;
    const lx = rho * Math.cos(phi);
    const ly = rho * Math.sin(phi) * 0.75;
    line.px[k] = origin[0] + ca * lx - sa * ly;
    line.py[k] = origin[1] + sa * lx + ca * ly;
    line.widths[k] = (0.025 + 0.06 * sk) * size;
    line.amps[k] = 0.6 * Math.pow(1 - sk, 0.9) + 0.06;
  }
  return line;
}

/** Screen centres of the main galaxy (A) and the secondary one (B). */
export function componentCenters(p: GalaxyParams): [[number, number], [number, number]] {
  const e = p.extra as MergerExtra;
  const ca = Math.cos(p.angle);
  const sa = Math.sin(p.angle);
  const place = (offset: readonly [number, number]): [number, number] => {
    const ox = offset[0] * p.size;
    const oy = offset[1] * p.size;
    return [p.cx + ca * ox - sa * oy, p.cy + sa * ox + ca * oy];
  };
  return [place(e.a_offset), place(e.b_offset)];
}

/** Density, young population and the frame of the main galaxy. */
export function merger(u: Float64Array, v: Float64Array, p: GalaxyParams, seed: number): { d: Float64Array; young: Float64Array; frame: Frame } {
  const e = p.extra as MergerExtra;
  const n = u.length;
  const ca = Math.cos(p.angle);
  const sa = Math.sin(p.angle);
  const [aPos, bPos] = componentCenters(p);
  const fa = makeFrame(u, v, aPos[0], aPos[1], p.size * e.a_scale, p.angle + e.a_angle, p.tilt);
  const a = spiralWith(fa, { ...p, arms: 2, pitch: e.a_pitch, arm_warp: 0.7 }, seed, false);
  const fb = makeFrame(u, v, bPos[0], bPos[1], p.size * e.b_scale, p.angle + e.b_angle, e.b_tilt);
  const b =
    e.b_kind === 'elliptical'
      ? elliptical(fb, { ...p, extra: { amp: 1.6, k: 3.3, exp: 0.6, shells: [] } }, seed + 101)
      : spiralWith(fb, { ...p, arms: 2, pitch: e.b_pitch, arm_warp: 0.8 }, seed + 101, false);

  const tailA = tail(aPos, e.tail_a_angle, e.tail_sweep, e.tail_length, p.size, ca, sa);
  const tailB = tail(bPos, e.tail_a_angle + Math.PI, e.tail_sweep, e.tail_length * 0.85, p.size, ca, sa);
  const s = linspace01(60);
  const bend = [-(bPos[1] - aPos[1]) * 0.25, (bPos[0] - aPos[0]) * 0.25];
  const bridge: Polyline = {
    px: new Float64Array(60),
    py: new Float64Array(60),
    widths: new Float64Array(60).fill(0.03 * p.size),
    amps: new Float64Array(60).fill(0.22),
  };
  for (let k = 0; k < 60; k++) {
    const sk = s[k]!;
    const bow = Math.sin(Math.PI * sk);
    bridge.px[k] = (1 - sk) * aPos[0] + sk * bPos[0] + bow * bend[0]!;
    bridge.py[k] = (1 - sk) * aPos[1] + sk * bPos[1] + bow * bend[1]!;
  }
  const lines = [tailA, tailB, bridge];
  const paths = lines; // bursts sit on tail A (0), tail B (1) or the bridge (2)
  const bursts = e.bursts.map(([path, pos, amp, radius]) => {
    const line = paths[path]!;
    const idx = Math.trunc(pos * (line.px.length - 1));
    const r = radius * p.size;
    return { bx: line.px[idx]!, by: line.py[idx]!, amp, r2: r * r };
  });
  const mx = (aPos[0] + bPos[0]) / 2;
  const my = (aPos[1] + bPos[1]) / 2;
  // Python's scalar `(0.5 * size) ** 2` is UCRT pow; V8 pow(x, 2) is x*x: one ulp at most (ENGINE_PORT §8).
  const halo2 = Math.pow(0.5 * p.size, 2);

  const d = new Float64Array(n);
  const young = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const uk = u[k]!;
    const vk = v[k]!;
    // Nucleus of the second galaxy (the main one's comes from the Core trait).
    const bx = fb.x[k]!;
    const by = fb.yb[k]!;
    const q = Math.sqrt(bx * bx + by * by) / 0.08;
    const dB = b.d[k]! + 0.7 * Math.exp(-(q * q));
    // Tidal streams: the maximum over every polyline point (max is exact in any order).
    let streams = 0;
    for (const line of lines) {
      for (let i = 0; i < line.px.length; i++) {
        const du = uk - line.px[i]!;
        const dv = vk - line.py[i]!;
        const w = line.widths[i]!;
        const val = line.amps[i]! * Math.exp(-(du * du + dv * dv) / (2 * w * w));
        if (val > streams) streams = val;
      }
    }
    // The tails break into clumps, like real star streams.
    streams *= 0.3 + 1.2 * Math.pow(fbmAt(uk * 7.0, vk * 7.0, seed + 31, 5), 1.5);
    // Star bursts triggered by the collision: young clusters on the tails and the bridge.
    let burst = 0;
    for (const { bx: cx, by: cy, amp, r2 } of bursts) {
      const du = uk - cx;
      const dv = vk - cy;
      burst += amp * Math.exp(-(du * du + dv * dv) / r2);
    }
    // Common halo: the diffuse light of the two galaxies already mixed.
    const hu = uk - mx;
    const hv = vk - my;
    const halo = 0.12 * Math.exp(-(hu * hu + hv * hv) / halo2);
    d[k] = a.d[k]! + dB * e.b_amp + streams + burst + halo;
    young[k] = Math.min(Math.max(a.young[k]! + b.young[k]! + streams * 0.8 + burst * 1.5, 0), 1);
  }
  return { d, young, frame: fa };
}
