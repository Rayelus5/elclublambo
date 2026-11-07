import { dist, draw, inEllipse, lit } from './fauna2';
import { P } from './palette';
import type { SpriteDef } from './types';

// The ground decoration of the M3b-3 biomes (DESIGN_SYSTEM §8 quater): three pieces per biome, still, drawn by rule
// in the biome's own keys, low and dark enough that the fauna always reads over them.

const C: [number, number] = [0.5, 0.5];
const still = (w: number, h: number, rows: string[]): SpriteDef => ({ w, h, fps: 0, anchor: C, palette: P, frames: [rows] });

/** A crystal cluster: `n` spires of the given heights. */
const crystals = (w: number, h: number, spires: [number, number][]) =>
  draw(w, h, (x, y) => {
    for (const [sx, top] of spires) {
      const half = 1.4 * ((y - top) / (h - top));
      if (y >= top && y < h - 1 && Math.abs(x + 0.5 - sx) <= Math.max(0.5, half + 0.6)) return x + 0.5 < sx ? 'i' : y > h - 4 ? 'd' : 'b';
    }
    return '.';
  });

/** A coral branch: a stem and side arms, in coral or teal. */
const coral = (w: number, h: number, teal: boolean, arms: [number, number, number][]) =>
  draw(w, h, (x, y) => {
    const [hi, mid] = teal ? ['j', 'J'] : ['q', 'Q'];
    const stem = Math.abs(x + 0.5 - w / 2) <= 0.6 && y >= 2 && y < h - 1;
    if (stem) return mid;
    for (const [ay, dir, len] of arms) {
      if (y === ay && dir * (x + 0.5 - w / 2) > 0 && Math.abs(x + 0.5 - w / 2) <= len) return hi;
      if (y === ay - 1 && Math.abs(x + 0.5 - (w / 2 + dir * len)) < 0.6) return 'w';
    }
    return '.';
  });

/** A lump of slag with embers. */
const slag = (w: number, h: number, embers: [number, number][]) =>
  draw(w, h, (x, y) => {
    if (!inEllipse(x, y, w / 2, h / 2 + 0.5, w / 2 - 1, h / 2 - 1)) return '.';
    if (embers.some(([ex, ey]) => ex === x && ey === y)) return 'o';
    return lit(x, y, w / 2, h / 2, w / 3, ['T', 't', 'L']);
  });

/** Floating shards of the rift. */
const shards = (w: number, h: number, pieces: [number, number, number][]) =>
  draw(w, h, (x, y) => {
    for (const [sx, sy, r] of pieces) {
      if (Math.abs(x + 0.5 - sx) + Math.abs(y + 0.5 - sy) <= r) return dist(x, y, sx - 0.5, sy - 0.5) < 0.8 ? 'v' : 'V';
    }
    return '.';
  });

export const DECOR: Record<string, SpriteDef> = {
  'ice-1': still(10, 10, crystals(10, 10, [[3, 2], [6, 4]])),
  'ice-2': still(8, 8, crystals(8, 8, [[4, 1]])),
  'ice-3': still(14, 10, crystals(14, 10, [[3, 4], [7, 1], [11, 3]])),
  'coral-1': still(10, 12, coral(10, 12, false, [[4, 1, 3], [7, -1, 3]])),
  'coral-2': still(8, 10, coral(8, 10, true, [[5, 1, 2]])),
  'coral-3': still(12, 12, coral(12, 12, true, [[3, -1, 4], [6, 1, 4], [9, -1, 3]])),
  'slag-1': still(12, 8, slag(12, 8, [[4, 4], [7, 3]])),
  'slag-2': still(8, 6, slag(8, 6, [[4, 3]])),
  'slag-3': still(16, 9, slag(16, 9, [[5, 4], [9, 5], [11, 3]])),
  'rift-1': still(10, 10, shards(10, 10, [[3.5, 3.5, 2], [7, 7, 1.5]])),
  'rift-2': still(8, 8, shards(8, 8, [[4, 4, 2.5]])),
  'rift-3': still(14, 10, shards(14, 10, [[3, 5, 2], [8, 3, 1.5], [11, 7, 2]])),
};
