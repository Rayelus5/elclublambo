import { fbmAt, smoothstep } from '../noise';
import type { EllipticalExtra, Geometry, LenticularExtra } from './common';

// geometry/elliptical.py: ellipticals (Sérsic-like profile, sometimes with shells) and lenticulars (bulge + disk).
export const elliptical: Geometry = (f, p, seed) => {
  const e = p.extra as EllipticalExtra;
  const n = f.x.length;
  const d = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const r = f.r[k]!;
    const nz = fbmAt(f.x[k]! * 2.2, f.y[k]! * 2.2, seed + 5, 4);
    let dk = e.amp * Math.exp(-e.k * Math.pow(r, e.exp)) * (0.9 + 0.2 * nz);
    // Tidal shells: faint arcs left by old mergers.
    for (const [radius, phase] of e.shells) {
      const side = smoothstep(-0.2, 0.6, Math.cos(f.th[k]! - phase));
      const q = (r - radius) / 0.022;
      dk += 0.09 * Math.exp(-(q * q)) * side * (0.6 + 0.8 * nz);
    }
    dk *= 1 - smoothstep(0.85, 1.1, r);
    d[k] = dk;
  }
  return { d, young: new Float64Array(n) };
};

export const lenticular: Geometry = (f, p, seed) => {
  const e = p.extra as LenticularExtra;
  const n = f.x.length;
  const d = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const r = f.r[k]!;
    const nz = fbmAt(f.x[k]! * 2.6, f.y[k]! * 2.6, seed + 9, 4);
    const disk = 0.85 * Math.exp(-r / p.disk_scale) * (0.92 + 0.16 * nz);
    const lens = 0.32 * Math.exp(-Math.pow(r / e.lens_radius, 4));
    const q = (r - e.ring_radius) / 0.05;
    const ring = e.ring_amp * Math.exp(-(q * q)) * (0.7 + 0.6 * nz);
    d[k] = (disk + lens + ring) * (1 - smoothstep(0.82, 1.05, r));
  }
  return { d, young: new Float64Array(n) };
};
