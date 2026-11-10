import type { SpriteDef } from './types';

// Turning pixel art (open beta): the probes face eight ways in the arena. Up and down are exact quarter turns; the
// diagonals use RotSprite: the grid is blown up 8× with Scale2x (three times, which keeps edges and smooths diagonals
// instead of making stairs of blocks), turned, and sampled back at the centre of each 8×8 block. Working on palette
// grids keeps every colour as it was: no blending, no new colours. Right is the drawing and left its mirror.

/** A quarter turn of a grid: 1 clockwise (the top row becomes the right column), -1 the other way. */
export function quarterTurn(rows: string[], dir: 1 | -1): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const out: string[] = [];
  for (let y = 0; y < w; y++) {
    let row = '';
    for (let x = 0; x < h; x++) row += dir === 1 ? rows[h - 1 - x]![y] : rows[x]![w - 1 - y];
    out.push(row);
  }
  return out;
}

/** Scale2x (EPX): twice the size; a corner takes its two neighbours' colour when they agree and the others do not. */
export function scale2x(rows: string[]): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const at = (x: number, y: number) => rows[Math.min(h - 1, Math.max(0, y))]![Math.min(w - 1, Math.max(0, x))]!;
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let top = '';
    let bottom = '';
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      top += (c === a && c !== d && a !== b ? a : p) + (a === b && a !== c && b !== d ? b : p);
      bottom += (d === c && d !== b && c !== a ? c : p) + (b === d && b !== a && d !== c ? d : p);
    }
    out.push(top, bottom);
  }
  return out;
}

/** RotSprite: the grid turned by `angle` (radians, clockwise on screen) about its centre, on a `size`×`size` grid. */
export function rotSprite(rows: string[], angle: number, size: number): string[] {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const big = scale2x(scale2x(scale2x(rows)));
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: string[] = [];
  for (let oy = 0; oy < size; oy++) {
    let row = '';
    for (let ox = 0; ox < size; ox++) {
      // The output pixel's centre, turned back into the source.
      const cx = ox + 0.5 - size / 2;
      const cy = oy + 0.5 - size / 2;
      const sx = cx * cos + cy * sin + w / 2;
      const sy = -cx * sin + cy * cos + h / 2;
      const bx = Math.floor(sx * 8);
      const by = Math.floor(sy * 8);
      row += bx >= 0 && by >= 0 && bx < w * 8 && by < h * 8 ? big[by]![bx]! : '.';
    }
    out.push(row);
  }
  return out;
}

/** A probe's four turned drawings (up, down and the two right-hand diagonals), with its frames, palette and timing. */
export function turnedProbe(id: string, def: SpriteDef): Record<string, SpriteDef> {
  const side = Math.ceil((Math.max(def.w, def.h) * 1.5) / 2) * 2;
  const quarter = (dir: 1 | -1): SpriteDef => ({ ...def, w: def.h, h: def.w, frames: def.frames.map((f) => quarterTurn(f, dir)) });
  const diagonal = (angle: number): SpriteDef => ({ ...def, w: side, h: side, frames: def.frames.map((f) => rotSprite(f, angle, side)) });
  return {
    [`${id}@n`]: quarter(-1),
    [`${id}@s`]: quarter(1),
    [`${id}@ne`]: diagonal(-Math.PI / 4),
    [`${id}@se`]: diagonal(Math.PI / 4),
  };
}

const VIEWS: { suffix: string; flip: 1 | -1 }[] = [
  { suffix: '', flip: 1 }, // right
  { suffix: '@se', flip: 1 },
  { suffix: '@s', flip: 1 },
  { suffix: '@se', flip: -1 }, // down-left: the mirror of down-right
  { suffix: '', flip: -1 }, // left
  { suffix: '@ne', flip: -1 },
  { suffix: '@n', flip: 1 },
  { suffix: '@ne', flip: 1 },
];

/** Which drawing of a probe faces `angle` (radians, clockwise from the right) and whether it is mirrored. */
export function probeView(id: string, angle: number): { id: string; flip: 1 | -1 } {
  const k = (((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8) as number;
  const v = VIEWS[k]!;
  return { id: `${id}${v.suffix}`, flip: v.flip };
}
