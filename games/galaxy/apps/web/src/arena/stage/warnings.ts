import type { SimEvent } from '@galaxy/sim';

// Warnings on the simulation's clock (GDD §17.3, DESIGN_SYSTEM §8 quater): a warning lives from the tick of its event
// for its ticks, measured in simulation time. A level-up choice, the pause, a slow frame or a frozen attacker never
// let a strike land after its warning has gone: when the simulation stops, the warning waits.

export interface Warning {
  kind: Extract<SimEvent, { t: 'telegraph' }>['kind'];
  x: number;
  y: number;
  angle: number;
  radius: number;
  /** The tick of the event that raised it. */
  start: number;
  /** How long it lasts, in ticks (when it strikes). */
  total: number;
}

export function warningFrom(e: Extract<SimEvent, { t: 'telegraph' }>, tick: number): Warning {
  return { kind: e.kind, x: e.x, y: e.y, angle: e.angle, radius: e.radius, start: tick, total: e.ticks };
}

/** How far a warning is (0–1) at simulation time `now` (ticks, with the frame's fraction); null once it has struck. */
export function warningProgress(w: Warning, now: number): number | null {
  if (w.total <= 0) return null;
  const k = (now - w.start) / w.total;
  return k >= 1 ? null : Math.max(0, k);
}
