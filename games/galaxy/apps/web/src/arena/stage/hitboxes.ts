import { ANGLE_STEPS, PROBE_RADIUS, type Sim } from '@galaxy/sim';

// The admin debug mode's collisions (2026-11-15): every body the sim tests against another, with its own radius, where
// the stage draws it (between its last and its current position). Pure, so the shapes are tested without a renderer.

export type HitTone = 'probe' | 'pickup' | 'enemy' | 'boss' | 'shot' | 'foe' | 'area' | 'prop' | 'beacon' | 'blast';

export type HitShape =
  | { kind: 'circle'; x: number; y: number; r: number; tone: HitTone }
  /** `angle` and `arc` in radians: the cone points at `angle` and opens `arc` in all. */
  | { kind: 'cone'; x: number; y: number; r: number; angle: number; arc: number; tone: HitTone };

const RAD = (Math.PI * 2) / ANGLE_STEPS;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Moving {
  top: number;
  alive: Uint8Array;
  x: Float64Array;
  y: Float64Array;
  px: Float64Array;
  py: Float64Array;
  radius: Float64Array;
}

function circles(out: HitShape[], pool: Moving, alpha: number, tone: (i: number) => HitTone | null): void {
  for (let i = 0; i < pool.top; i++) {
    if (!pool.alive[i]) continue;
    const t = tone(i);
    if (!t) continue;
    out.push({ kind: 'circle', x: lerp(pool.px[i]!, pool.x[i]!, alpha), y: lerp(pool.py[i]!, pool.y[i]!, alpha), r: pool.radius[i]!, tone: t });
  }
}

export function hitboxShapes(sim: Sim, alpha: number): HitShape[] {
  const out: HitShape[] = [];
  const pr = sim.props;
  for (let i = 0; i < pr.top; i++) if (pr.alive[i]) out.push({ kind: 'circle', x: pr.x[i]!, y: pr.y[i]!, r: pr.radius[i]!, tone: 'prop' });
  const ar = sim.areas;
  for (let i = 0; i < ar.top; i++) {
    if (!ar.alive[i]) continue;
    const x = lerp(ar.px[i]!, ar.x[i]!, alpha);
    const y = lerp(ar.py[i]!, ar.y[i]!, alpha);
    const arc = ar.arc[i]!;
    if (arc > 0) out.push({ kind: 'cone', x, y, r: ar.radius[i]!, angle: ar.angle[i]! * RAD, arc: arc * RAD, tone: 'area' });
    else out.push({ kind: 'circle', x, y, r: ar.radius[i]!, tone: 'area' });
  }
  for (const b of sim.blasts) out.push({ kind: 'circle', x: b.x, y: b.y, r: b.radius, tone: 'blast' });
  if (sim.beacon) out.push({ kind: 'circle', x: sim.beacon.x, y: sim.beacon.y, r: sim.beacon.radius, tone: 'beacon' });
  circles(out, sim.enemies, alpha, (i) => (sim.enemies.boss[i] ? 'boss' : 'enemy'));
  circles(out, sim.shots, alpha, () => 'shot');
  circles(out, sim.foeShots, alpha, () => 'foe');
  for (const p of sim.probes) {
    if (!p.alive) continue;
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha);
    out.push({ kind: 'circle', x, y, r: p.stats.pickup, tone: 'pickup' });
    out.push({ kind: 'circle', x, y, r: PROBE_RADIUS, tone: 'probe' });
  }
  return out;
}
