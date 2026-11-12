// Pinning a marker to the edge of the play field (Nov plan A2). The beacon, the co-op marks and the teammates'
// arrows all point at something off screen the same way: a point inside the free field stays where it is; one outside
// slides along the line from the field's centre until it meets the free field's edge (`pad` in from the side bars
// and, for the teammates' arrows, from the HUD's panels: `insets`).

/** The screen: its size and the side bars of an ultrawide (the field is the part between them). */
export type Field = { width: number; height: number; bars: number };
/** Bands of the screen covered by the HUD, in pixels from each edge. */
export type Insets = { top: number; right: number; bottom: number; left: number };
export type EdgePoint = { x: number; y: number; angle: number; inside: boolean };

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The free field's box: inside the bars and the HUD's bands, `pad` in. */
export function freeBox(field: Field, pad: number, insets: Insets = NO_INSETS): { x0: number; x1: number; y0: number; y1: number } {
  return {
    x0: Math.max(field.bars, insets.left) + pad,
    x1: field.width - Math.max(field.bars, insets.right) - pad,
    y0: insets.top + pad,
    y1: field.height - insets.bottom - pad,
  };
}

/** `dx`, `dy`: where the target is, in screen pixels from the field's centre. */
export function edgePoint(field: Field, dx: number, dy: number, pad: number, insets: Insets = NO_INSETS): EdgePoint {
  const cx = field.bars + (field.width - field.bars * 2) / 2;
  const cy = field.height / 2;
  const b = freeBox(field, pad, insets);
  const sx = cx + dx;
  const sy = cy + dy;
  if (sx > b.x0 && sx < b.x1 && sy > b.y0 && sy < b.y1) return { x: sx, y: sy, angle: 0, inside: true };
  const angle = Math.atan2(dy, dx);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Along the ray from the centre, the first side of the box it crosses (the box need not be centred).
  const kx = c > 1e-9 ? (b.x1 - cx) / c : c < -1e-9 ? (b.x0 - cx) / c : Infinity;
  const ky = s > 1e-9 ? (b.y1 - cy) / s : s < -1e-9 ? (b.y0 - cy) / s : Infinity;
  const k = Math.max(0, Math.min(kx, ky));
  return { x: cx + c * k, y: cy + s * k, angle, inside: false };
}
