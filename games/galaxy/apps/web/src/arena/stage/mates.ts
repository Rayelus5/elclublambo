import type { ProbeLife } from '@galaxy/sim';
import { edgePoint, type Field } from './edge';

// Arrows towards teammates off screen (Nov plan A2): where each one is, in their colour at the field's edge, with
// their name and life. Red while down (go and revive them), faint while away. None for me, for whoever is on screen,
// or for those out until the next layer or gone from the run.

export type MateProbe = { x: number; y: number; hp: number; maxHp: number; life: ProbeLife };
export type MateMarker = { index: number; x: number; y: number; angle: number; hp: number; state: 'ok' | 'down' | 'away' };

/** How far in from the field's edge the arrows sit (room for the name and the life bar beside them). */
export const MATE_PAD = 34;

export function mateMarkers(probes: readonly MateProbe[], camera: { x: number; y: number; zoom: number }, field: Field, me: number): MateMarker[] {
  const out: MateMarker[] = [];
  probes.forEach((p, index) => {
    if (index === me || p.life === 'out' || p.life === 'left') return;
    const at = edgePoint(field, (p.x - camera.x) * camera.zoom, (p.y - camera.y) * camera.zoom, MATE_PAD);
    if (at.inside) return;
    const state = p.life === 'down' ? 'down' : p.life === 'away' ? 'away' : 'ok';
    out.push({ index, x: at.x, y: at.y, angle: at.angle, hp: Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp))), state });
  });
  return out;
}
