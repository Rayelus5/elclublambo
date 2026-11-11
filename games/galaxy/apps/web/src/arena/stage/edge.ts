// Pinning a marker to the edge of the play field (Nov plan A2). The beacon, the co-op marks and the teammates'
// arrows all point at something off screen the same way: a point inside the field stays where it is; one outside
// slides along the line from the field's centre until it meets the inner edge (`pad` in from the side bars).

/** The screen: its size and the side bars of an ultrawide (the field is the part between them). */
export type Field = { width: number; height: number; bars: number };
export type EdgePoint = { x: number; y: number; angle: number; inside: boolean };

/** `dx`, `dy`: where the target is, in screen pixels from the field's centre. */
export function edgePoint(field: Field, dx: number, dy: number, pad: number): EdgePoint {
  const fieldW = field.width - field.bars * 2;
  const cx = field.bars + fieldW / 2;
  const cy = field.height / 2;
  const sx = cx + dx;
  const sy = cy + dy;
  if (sx > field.bars + pad && sx < field.width - field.bars - pad && sy > pad && sy < field.height - pad) return { x: sx, y: sy, angle: 0, inside: true };
  const angle = Math.atan2(dy, dx);
  const kx = (fieldW / 2 - pad) / Math.max(1e-6, Math.abs(Math.cos(angle)));
  const ky = (field.height / 2 - pad) / Math.max(1e-6, Math.abs(Math.sin(angle)));
  const k = Math.min(kx, ky);
  return { x: cx + Math.cos(angle) * k, y: cy + Math.sin(angle) * k, angle, inside: false };
}
