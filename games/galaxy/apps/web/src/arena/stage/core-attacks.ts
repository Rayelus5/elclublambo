import { activeLaser, type Sim } from '@galaxy/sim';
import type { Graphics } from 'pixi.js';
import type { Warning } from './warnings';

// The Cores' attacks of the November plan (B4), drawn apart from the stage so it only calls in: the warnings of a
// laser (its line, like a lance's, and the fan it will sweep) and of a closing ring (the ring and its way out), and the
// laser itself while it burns. Every attack shows before it hurts (GDD §17.3).

const STEP_RAD = (Math.PI * 2) / 4096;
const STATIC = 0xff4d6d;
const NOVA = 0xff6b7a;
const INK = 0xf3f5ff;

/** True when `w` is one of the warnings drawn here. */
export const isCoreWarning = (w: Warning) => w.kind === 'laser' || w.kind === 'closing';

/** One warning of a laser or a closing ring at progress `k` (0–1); `pulse` is the stage's warning pulse. */
export function drawCoreWarning(g: Graphics, w: Warning, k: number, pulse: number): void {
  const a = w.angle * STEP_RAD;
  if (w.kind === 'laser') {
    const to = a + w.arc * STEP_RAD;
    // The fan it will sweep, darker towards where it stops, and the line where it stops.
    if (w.arc !== 0) {
      g.moveTo(w.x, w.y)
        .arc(w.x, w.y, w.radius, Math.min(a, to), Math.max(a, to))
        .closePath()
        .fill({ color: STATIC, alpha: 0.06 + 0.08 * k });
      g.moveTo(w.x, w.y)
        .lineTo(w.x + Math.cos(to) * w.radius, w.y + Math.sin(to) * w.radius)
        .stroke({ width: 1, color: STATIC, alpha: 0.55 });
      // An arrow head on the far edge says which way it turns.
      const r = w.radius * 0.92;
      const side = Math.sign(w.arc);
      const tip = { x: w.x + Math.cos(to) * r, y: w.y + Math.sin(to) * r };
      const back = to - side * 0.06;
      for (const off of [-10, 10]) {
        g.moveTo(tip.x, tip.y)
          .lineTo(w.x + Math.cos(back) * (r + off), w.y + Math.sin(back) * (r + off))
          .stroke({ width: 2, color: STATIC, alpha: 0.75 });
      }
    }
    // Its first line, like a lance's: a wide pulse and a thin line that fills up to the strike.
    const ex = w.x + Math.cos(a) * w.radius;
    const ey = w.y + Math.sin(a) * w.radius;
    g.moveTo(w.x, w.y).lineTo(ex, ey).stroke({ width: 10, color: STATIC, alpha: pulse });
    g.moveTo(w.x, w.y)
      .lineTo(w.x + (ex - w.x) * k, w.y + (ey - w.y) * k)
      .stroke({ width: 2, color: NOVA, alpha: 0.9 });
    return;
  }
  // A closing ring: thicker as it comes, open where the way out is, its edges marked in white.
  const half = (w.arc * STEP_RAD) / 2;
  g.moveTo(w.x + Math.cos(a + half) * w.radius, w.y + Math.sin(a + half) * w.radius)
    .arc(w.x, w.y, w.radius, a + half, a + Math.PI * 2 - half)
    .stroke({ width: 1 + 3 * k, color: STATIC, alpha: Math.min(1, pulse + 0.35) });
  for (const edge of [a - half, a + half]) {
    g.moveTo(w.x + Math.cos(edge) * (w.radius - 8), w.y + Math.sin(edge) * (w.radius - 8))
      .lineTo(w.x + Math.cos(edge) * (w.radius + 8), w.y + Math.sin(edge) * (w.radius + 8))
      .stroke({ width: 2, color: INK, alpha: 0.85 });
  }
}

/** The Core's laser while it burns, on the additive layer: a glow, the beam and a white core. */
export function drawCoreBeam(g: Graphics, sim: Sim, reduced: boolean, clock: number): void {
  const l = activeLaser(sim);
  if (!l) return;
  const a = l.angle * STEP_RAD;
  const ex = l.x + Math.cos(a) * l.length;
  const ey = l.y + Math.sin(a) * l.length;
  const flick = reduced ? 0.8 : 0.7 + 0.2 * Math.sin(clock * 50);
  g.moveTo(l.x, l.y).lineTo(ex, ey).stroke({ width: l.width + 8, color: STATIC, alpha: 0.25 * flick });
  g.moveTo(l.x, l.y).lineTo(ex, ey).stroke({ width: l.width, color: NOVA, alpha: 0.75 * flick });
  g.moveTo(l.x, l.y)
    .lineTo(ex, ey)
    .stroke({ width: Math.max(2, l.width * 0.35), color: INK, alpha: 0.95 });
  g.circle(l.x, l.y, l.width * 0.9).fill({ color: NOVA, alpha: 0.5 * flick });
  g.circle(ex, ey, l.width * 0.7).fill({ color: INK, alpha: 0.6 * flick });
}
