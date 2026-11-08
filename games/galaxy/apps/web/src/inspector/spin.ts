// Turning the 3D inspector's card by hand (M6d-1, the owner's request): its yaw ("spin", in radians) follows a sideways
// drag — the card's whole width is a turn and a half — and settles on the nearest face when let go; the «Ver el
// reverso» button turns it to the other face from wherever it rests. Multiples of π are faces: even the front, odd the
// back.

export type Face = 'front' | 'back';

/** The spin after dragging `dx` pixels across a card `width` pixels wide, from `start`. */
export function dragSpin(start: number, dx: number, width: number): number {
  return width > 0 ? start + (dx / width) * Math.PI * 1.5 : start;
}

/** The nearest face's spin. */
export function settle(spin: number): number {
  return Math.round(spin / Math.PI) * Math.PI;
}

export function faceOf(spin: number): Face {
  const n = Math.round(spin / Math.PI);
  return ((n % 2) + 2) % 2 === 0 ? 'front' : 'back';
}

/** The spin that shows `face` from where the card rests: the same if it shows already, otherwise half a turn on. */
export function toFace(spin: number, face: Face): number {
  const s = settle(spin);
  return faceOf(s) === face ? s : s + Math.PI;
}
