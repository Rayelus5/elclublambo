import type { RoomId } from '@galaxy/shared';

// The station's rooms (GDD §10, DESIGN_SYSTEM §8 septies): scenes painted in Aseprite at 64×44 by
// `art/station/paint-rooms.lua` (editable layers in art/station/*.aseprite), exported as horizontal strips of four
// frames that CSS plays with steps(). A broken room has its lights off, a crack, a sparking cable and the Static; the
// refinery and the antenna grow with their level (more tanks, more dishes).

export const ROOM_FRAMES = 4;

/** The strips as served files, never inlined: only the ten in sight are fetched, and they stay out of the bundle. */
const SHEETS = import.meta.glob<string>('./rooms/*.png', { eager: true, query: '?no-inline', import: 'default' });

/** The strip of a room in a state (the refinery and the antenna by level, 1–5). */
export function roomSheet(id: RoomId, state: 'working' | 'broken', level: number): string {
  if (state === 'broken') return `${id}-broken`;
  return id === 'refinery' || id === 'antenna' ? `${id}-${Math.max(1, Math.min(5, level))}` : id;
}

export function roomSheetUrl(id: RoomId, state: 'working' | 'broken', level: number): string | undefined {
  return SHEETS[`./rooms/${roomSheet(id, state, level)}.png`];
}
