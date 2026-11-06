import { fbmAt, smoothstep } from '../noise';
import type { Geometry, RingExtra } from './common';

// geometry/ring.py: ring galaxies, a ring with star-forming knots, faint spokes and an offset core.
export const ring: Geometry = (f, p, seed) => {
  const e = p.extra as RingExtra;
  const n = f.x.length;
  const d = new Float64Array(n);
  const young = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const r = f.r[k]!;
    const nz = fbmAt(f.x[k]! * 3.5 + 2.0, f.y[k]! * 3.5 - 1.0, seed + 7, 5);
    const q = (r - e.radius) / e.width;
    const band = Math.exp(-(q * q));
    const knots = band * (0.25 + 1.5 * Math.pow(nz, 1.6));
    let spokes = Math.pow((1 + Math.cos(e.spokes * f.th[k]! + 3 * (nz - 0.5))) * 0.5, 10);
    spokes *= smoothstep(0.12, 0.3, r) * (1 - smoothstep(e.radius - 0.14, e.radius - 0.03, r));
    const inner = 0.12 * Math.exp(-r / 0.25);
    let dk = e.amp * knots + e.spoke_amp * spokes + inner;
    dk *= 1 - smoothstep(e.radius + 0.15, e.radius + 0.35, r);
    d[k] = dk;
    young[k] = knots * nz;
  }
  return { d, young };
};
