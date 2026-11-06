import { fbmAt, smoothstep } from '../noise';
import type { Frame, GalaxyParams, Geometry } from './common';

// geometry/spiral.py: spirals and barred spirals, arms on a logarithmic spiral r = r0 · e^(θ·pitch).
export function spiralWith(f: Frame, p: GalaxyParams, seed: number, barred: boolean): { d: Float64Array; young: Float64Array } {
  const n = f.x.length;
  const d = new Float64Array(n);
  const young = new Float64Array(n);
  const r0 = barred ? p.bar_length * 0.95 : 0.06;
  const barLo = p.bar_length * 0.55;
  const barHi = p.bar_length * 1.15;
  const armScale = p.disk_scale * 1.3;
  for (let k = 0; k < n; k++) {
    const x = f.x[k]!;
    const y = f.y[k]!;
    const r = f.r[k]!;
    const warp = (fbmAt(x * 1.6 + 3.1, y * 1.6 - 7.4, seed + 11, 4) - 0.5) * 2 * p.arm_warp;
    const phase = p.arms * (f.th[k]! + warp - Math.log((r + 0.015) / r0) / p.pitch);
    let arm = Math.pow((1 + Math.cos(phase)) * 0.5, p.arm_sharpness);
    if (barred) arm *= smoothstep(barLo, barHi, r);
    const clump = fbmAt(x * 4.5, y * 4.5, seed + 23, 5);
    // Dust lanes on the inner edge of the arms.
    const dust = Math.pow((1 + Math.cos(phase - p.dust_offset)) * 0.5, 14) * smoothstep(0.08, 0.25, r);
    // The arms fade slower than the disk: they reach further and stand out from the space between them.
    const disk = Math.exp(-r / p.disk_scale);
    const armEnvelope = Math.exp(-r / armScale);
    let dk = (disk * p.interarm + armEnvelope * p.arm_amp * arm * (0.35 + 1.15 * clump)) * (1 - p.dust * dust);
    if (barred) {
      const bx = x / p.bar_length;
      const by = y / p.bar_width;
      const bar = Math.exp(-(bx * bx) - by * by);
      dk += p.bar_amp * bar * (0.75 + 0.5 * clump);
    }
    dk *= 1 - smoothstep(0.82, 1.08, r);
    d[k] = dk;
    young[k] = arm * clump * smoothstep(0.12, 0.35, r);
  }
  return { d, young };
}

export const spiral: Geometry = (f, p, seed) => spiralWith(f, p, seed, false);
export const barredSpiral: Geometry = (f, p, seed) => spiralWith(f, p, seed, true);
