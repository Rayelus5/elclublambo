import type { SimEvent } from '@galaxy/sim';
import type { Graphics } from 'pixi.js';

// A relic's anomaly (a negative glitch of reality, systems/relics.ts): it throws the probe aside, freezes what is near
// or strikes a few enemies. It once happened with no sign at all and looked like a bug of the game (the owner); now it
// speaks the arena's own glitch language: the Static's red and cyan split and the rift's lilac and magenta tear, moving
// in steps (never smoothly), small and local. Photosensitivity: nothing full screen, at most 0.35 of opacity for the
// tear (the storm's cap) and at most two tears a second. With reduced motion: no jitter and no tear, a still outline.

export type AnomalyEvent = Extract<SimEvent, { t: 'anomaly' }>;

/** How long an anomaly's marks last (s). */
export const ANOMALY_LIFE = 0.42;
/** The thrown probe shows split in red and cyan copies, and flickers in as it lands, this long (s). */
export const SPLIT_S = 0.3;
export const GLITCH_RED = 0xff4d6d;
export const GLITCH_CYAN = 0x6fe3ff;
export const GLITCH_MAGENTA = 0xe05cff;
export const GLITCH_LILAC = 0xb39dff;
/** The tear's opacity cap (the storm's OVERLAY_MAX) and the least time between two tears (s). */
export const TEAR_ALPHA = 0.35;
export const TEAR_GAP = 0.5;
/** Glitches move in jumps: this many steps a second. */
const STEPS = 20;

export interface AnomalyMark {
  e: AnomalyEvent;
  /** The stage's clock when it went off (s). */
  at: number;
  /** Mine (the camera's probe): the full effect; a teammate's is smaller. */
  mine: boolean;
  /** Whether this one tears (only mine, and not within TEAR_GAP of the last tear). */
  tear: boolean;
  /** For its jitter: the same anomaly jumps the same way on every frame of a step. */
  seed: number;
}

/** A glitch's step at `age` (s): a whole number that changes STEPS times a second. */
export const stepAt = (age: number): number => Math.floor(age * STEPS);

/** Hash noise in [-1, 1) for (seed, step, k): the same inputs, the same jump. */
export function jitter(seed: number, step: number, k: number): number {
  let h = (seed ^ Math.imul(step + 1, 374761393) ^ Math.imul(k + 1, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2147483648 - 1;
}

/** The probe's alpha while it lands from a throw ("tuning in", in steps), or 1 once it is in (or with reduced motion). */
export function landingAlpha(age: number, reduced: boolean): number {
  if (reduced || age < 0 || age >= SPLIT_S) return 1;
  return [0.25, 0.85, 0.4, 1, 0.6, 1][stepAt(age) % 6]!;
}

/** How far apart the red and cyan copies of a thrown probe are drawn (px), shrinking to 0 by SPLIT_S. */
export function splitOffset(m: AnomalyMark, age: number, reduced: boolean): number {
  if (age < 0 || age >= SPLIT_S) return 0;
  const k = 1 - age / SPLIT_S;
  if (reduced) return 0;
  return Math.max(1, Math.round((2 + 2 * Math.abs(jitter(m.seed, stepAt(age), 9))) * k));
}

type Pen = Pick<Graphics, 'moveTo' | 'lineTo' | 'rect' | 'circle' | 'stroke' | 'fill'>;

/** Draws one anomaly at `age` (s) on `g`; false once it is over (drop it). */
export function drawAnomaly(g: Pen, m: AnomalyMark, age: number, reduced: boolean): boolean {
  if (age < 0) return true;
  if (age >= ANOMALY_LIFE) return false;
  const k = age / ANOMALY_LIFE;
  const fade = 1 - k;
  const step = reduced ? 0 : stepAt(age);
  const { e } = m;
  if (e.what === 'blink') {
    if (reduced) {
      // A still magenta outline where it was and where it landed, fading.
      g.circle(e.fx, e.fy, 14).stroke({ width: 1, color: GLITCH_MAGENTA, alpha: 0.35 * fade });
      g.circle(e.tx, e.ty, 16).stroke({ width: 2, color: GLITCH_MAGENTA, alpha: 0.6 * fade });
      return true;
    }
    // The static it crossed: a broken line from where it was to where it is, its pieces jumping.
    const n = 7;
    for (let s = 0; s < n; s++) {
      if (jitter(m.seed, step, s) < -0.35) continue;
      const a = s / n;
      const b = (s + 0.6) / n;
      const off = jitter(m.seed, step, s + 20) * 3;
      g.moveTo(e.fx + (e.tx - e.fx) * a, e.fy + (e.ty - e.fy) * a + off)
        .lineTo(e.fx + (e.tx - e.fx) * b, e.fy + (e.ty - e.fy) * b + off)
        .stroke({ width: 1, color: s % 2 ? GLITCH_CYAN : GLITCH_MAGENTA, alpha: (m.mine ? 0.7 : 0.45) * fade });
    }
    if (m.tear && age < 0.26) {
      // The tear: thin slices of the field around where it was and where it lands, slid sideways.
      tear(g, m, e.fx, e.fy, step, fade, 0);
      if (age > 0.06) tear(g, m, e.tx, e.ty, step, fade, 10);
    }
    return true;
  }
  if (e.what === 'freeze') {
    if (reduced) {
      g.circle(e.fx, e.fy, e.radius).stroke({ width: 1, color: GLITCH_LILAC, alpha: 0.5 * fade });
      return true;
    }
    // A ring of static closing onto its reach, in broken arcs that jump; a faint lilac over what it froze.
    const ease = 1 - (1 - Math.min(1, age / 0.18)) ** 2;
    const r = e.radius * (1.3 - 0.3 * ease);
    const parts = 14;
    for (let s = 0; s < parts; s++) {
      if (jitter(m.seed, step, s) < -0.4) continue;
      const a0 = (s / parts) * Math.PI * 2 + jitter(m.seed, step, s + 40) * 0.08;
      const a1 = a0 + (Math.PI * 2) / parts - 0.12;
      const rr = r + jitter(m.seed, step, s + 60) * 2;
      g.moveTo(e.fx + Math.cos(a0) * rr, e.fy + Math.sin(a0) * rr)
        .lineTo(e.fx + Math.cos(a1) * rr, e.fy + Math.sin(a1) * rr)
        .stroke({ width: 2, color: s % 3 === 0 ? GLITCH_CYAN : GLITCH_LILAC, alpha: (m.mine ? 0.8 : 0.5) * fade });
    }
    g.circle(e.fx, e.fy, e.radius).fill({ color: GLITCH_LILAC, alpha: Math.min(TEAR_ALPHA, 0.07) * fade });
    return true;
  }
  // strike: a broken bolt from the probe to each one it hit, in magenta or cyan, its bends jumping.
  for (let t = 0; t + 1 < e.targets.length; t += 2) {
    const x = e.targets[t]!;
    const y = e.targets[t + 1]!;
    const dx = x - e.fx;
    const dy = y - e.fy;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const bends = 5;
    g.moveTo(e.fx, e.fy);
    for (let b = 1; b < bends; b++) {
      const f = b / bends;
      const off = reduced ? 0 : jitter(m.seed, step, t * 8 + b) * Math.min(12, len / 6);
      g.lineTo(e.fx + dx * f + nx * off, e.fy + dy * f + ny * off);
    }
    g.lineTo(x, y).stroke({ width: m.mine ? 2 : 1, color: (t / 2) % 2 ? GLITCH_CYAN : GLITCH_MAGENTA, alpha: (reduced ? 0.6 : 0.9) * fade });
    g.circle(x, y, reduced ? 6 : 5 + 4 * k).stroke({ width: 1, color: GLITCH_RED, alpha: 0.6 * fade });
  }
  return true;
}

function tear(g: Pen, m: AnomalyMark, x: number, y: number, step: number, fade: number, salt: number): void {
  for (let s = 0; s < 4; s++) {
    const w = 22 + Math.abs(jitter(m.seed, step, salt + s)) * 18;
    const slide = jitter(m.seed, step, salt + s + 4) * 8;
    const sy = y - 13 + s * 7 + Math.round(jitter(m.seed, step, salt + s + 8) * 2);
    g.rect(Math.round(x - w / 2 + slide), sy, Math.round(w), 2).fill({ color: s % 2 ? GLITCH_LILAC : GLITCH_MAGENTA, alpha: TEAR_ALPHA * fade });
  }
}
