import { smoothstep, warpedFbmAt } from '../noise';
import { gaussianBlob, type Frame, type GalaxyParams, type Geometry, type IrregularExtra } from './common';

// geometry/irregular.py: irregulars (noise clouds with star-forming knots) and dwarfs (spheroidal or irregular).
export function irregularWith(f: Frame, p: GalaxyParams, seed: number, amplitude: number): { d: Float64Array; young: Float64Array } {
  const e = p.extra as IrregularExtra;
  const n = f.x.length;
  const d = new Float64Array(n);
  const young = new Float64Array(n);
  // Python scalar `env_radius ** 2` is UCRT pow; V8's pow(x, 2) is x*x. At most one ulp apart (ENGINE_PORT §8).
  const twoR2 = 2 * Math.pow(e.env_radius, 2);
  for (let k = 0; k < n; k++) {
    const x = f.x[k]!;
    const y = f.y[k]!;
    const w = warpedFbmAt(x * 1.8 + e.ox, y * 1.8 + e.oy, seed + 3, 0.7, 5);
    const ex = x - e.env_dx;
    const ey = y - e.env_dy;
    const envelope = Math.exp(-(ex * ex + ey * ey) / twoR2);
    const cloud = envelope * Math.pow(smoothstep(0.32, 0.8, w), 1.4) * (0.6 + 0.8 * w);
    let knots = 0;
    for (const [kx, ky, radius, amp] of e.knots) knots += amp * gaussianBlob(x, y, kx, ky, radius);
    d[k] = amplitude * (1.6 * cloud + knots);
    young[k] = Math.min(Math.max(knots * 1.5 + cloud * 0.6, 0), 1);
  }
  return { d, young };
}

export const irregular: Geometry = (f, p, seed) => irregularWith(f, p, seed, 1.0);

export const dwarf: Geometry = (f, p, seed) => {
  const e = p.extra as IrregularExtra;
  if (e.kind === 'irregular') return irregularWith(f, p, seed, 0.6);
  // Spheroidal dwarf: faint and grainy, with its resolved stars as the protagonists.
  const n = f.x.length;
  const d = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const w = warpedFbmAt(f.x[k]! * 2.0, f.y[k]! * 2.0, seed + 5, 0.4, 4);
    const q = f.r[k]! / 0.5;
    d[k] = 0.55 * Math.exp(-(q * q)) * (0.7 + 0.6 * w);
  }
  return { d, young: new Float64Array(n) };
};
