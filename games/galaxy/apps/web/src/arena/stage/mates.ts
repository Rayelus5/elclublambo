import type { ProbeLife } from '@galaxy/sim';
import { edgePoint, type Field, freeBox, type Insets, NO_INSETS } from './edge';

// Arrows towards teammates off screen (Nov plan A2): where each one is, in their colour at the field's edge, with
// their name and life. Red while down (go and revive them), faint while away. None for me, for whoever is on screen,
// or for those out until the next layer or gone from the run. They keep out of the HUD's panels (`insets`) and, when
// several point the same way, spread along the edge so no name covers another.

export type MateProbe = { x: number; y: number; hp: number; life: ProbeLife; stats: { maxHp: number } };
export type MateMarker = { index: number; x: number; y: number; angle: number; hp: number; state: 'ok' | 'down' | 'away' };

/** How far in from the free field's edge the arrows sit (room for the name and the life bar beside them). */
export const MATE_PAD = 34;
/** The least distance between two markers on the same side (a name and its bar). */
export const MATE_GAP = 34;

const EPS = 0.5;

export function mateMarkers(probes: readonly MateProbe[], camera: { x: number; y: number; zoom: number }, field: Field, me: number, insets: Insets = NO_INSETS): MateMarker[] {
  const out: MateMarker[] = [];
  probes.forEach((p, index) => {
    if (index === me || p.life === 'out' || p.life === 'left') return;
    const at = edgePoint(field, (p.x - camera.x) * camera.zoom, (p.y - camera.y) * camera.zoom, MATE_PAD, insets);
    if (at.inside) return;
    const state = p.life === 'down' ? 'down' : p.life === 'away' ? 'away' : 'ok';
    out.push({ index, x: at.x, y: at.y, angle: at.angle, hp: Math.max(0, Math.min(1, p.hp / Math.max(1, p.stats.maxHp))), state });
  });
  if (out.length > 1) spread(out, freeBox(field, MATE_PAD, insets));
  return out;
}

/** Markers on the same side of the box are pushed apart along it, at least MATE_GAP, staying on that side. */
function spread(ms: MateMarker[], b: { x0: number; x1: number; y0: number; y1: number }): void {
  const sides: [MateMarker[], 'x' | 'y', number, number][] = [
    [ms.filter((m) => Math.abs(m.x - b.x0) < EPS), 'y', b.y0, b.y1],
    [ms.filter((m) => Math.abs(m.x - b.x1) < EPS), 'y', b.y0, b.y1],
    [ms.filter((m) => Math.abs(m.y - b.y0) < EPS && Math.abs(m.x - b.x0) >= EPS && Math.abs(m.x - b.x1) >= EPS), 'x', b.x0, b.x1],
    [ms.filter((m) => Math.abs(m.y - b.y1) < EPS && Math.abs(m.x - b.x0) >= EPS && Math.abs(m.x - b.x1) >= EPS), 'x', b.x0, b.x1],
  ];
  for (const [group, axis, lo, hi] of sides) {
    if (group.length < 2) continue;
    group.sort((a, c) => a[axis] - c[axis] || a.index - c.index);
    for (let k = 1; k < group.length; k++) group[k]![axis] = Math.max(group[k]![axis], group[k - 1]![axis] + MATE_GAP);
    // Past the far end: slide the whole group back, never past the near end.
    const over = group[group.length - 1]![axis] - hi;
    if (over > 0) for (const m of group) m[axis] = Math.max(lo, m[axis] - over);
  }
}
