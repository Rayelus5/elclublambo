import type { CSSProperties } from 'react';
import { avatarArt, frameArt } from '../profile/art';

// A player's avatar (Nov plan C2): the one they chose (pixel art, 32×32 at a whole scale; an animated strip plays its
// frames) inside their frame (48×48 pixel art round it), or, without an avatar or its art, a drawing made from the
// name: a mirrored 5×5 pattern in one accent colour, stable for a name (FNV-1a) — «Tu firma».
const INKS = ['var(--color-solar)', 'var(--color-nova)', 'var(--color-terminal)', 'var(--color-ice)', 'var(--color-uv)'];

function fnv(text: string): number {
  let h = 2166136261;
  for (const c of text) {
    h ^= c.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The drawing made from a name. */
export function Signature({ name }: { name: string }) {
  const h = fnv(name);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((h >>> (y * 3 + x)) & 1) {
        cells.push({ x, y });
        if (x < 2) cells.push({ x: 4 - x, y });
      }
    }
  }
  return (
    <svg className="avatar" viewBox="-1 -1 7 7" aria-hidden="true" shapeRendering="crispEdges">
      {cells.map((c) => (
        <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill={INKS[(h >>> 16) % INKS.length]} />
      ))}
    </svg>
  );
}

const strip = (url: string, frames: number) => ({ backgroundImage: `url(${url})`, '--frames': String(frames) }) as CSSProperties;

/**
 * `size`: the avatar's side in px, a whole multiple of 32 (the frame adds a quarter of it round each side); 48 only where
 * a frameless avatar must match a framed one's 48 px (the top bar's pill). With `fit="outer"` (plan «escáner pro», part
 * E: the podium and the profile), `size` is the whole footprint instead: a framed avatar fits its frame in it, and a
 * frameless one fills it, so both measure the same from outside.
 */
export function Avatar({ name, avatar, frame, size = 32, fit = 'inner' }: { name: string; avatar?: string | null; frame?: string | null; size?: number; fit?: 'inner' | 'outer' }) {
  const art = avatar ? avatarArt(avatar) : undefined;
  const ring = frame ? frameArt(frame) : undefined;
  const scale = fit === 'outer' && ring ? size / 48 : size / 32;
  return (
    <span className="avatar-box" style={{ '--s': String(scale) } as CSSProperties} data-fit={fit === 'outer' ? 'outer' : undefined} data-ring={frame && !ring ? frame : undefined} aria-hidden="true">
      {art ? <span className={`avatar-art${art.frames > 1 ? ' anim' : ''}`} style={strip(art.url, art.frames)} /> : <Signature name={name} />}
      {ring ? <span className={`avatar-frame${ring.frames > 1 ? ' anim' : ''}`} style={strip(ring.url, ring.frames)} /> : null}
    </span>
  );
}
