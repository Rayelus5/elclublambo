import type { RoomId } from '@galaxy/shared';
import { P } from '../arena/sprites/palette';
import type { SpriteDef } from '../arena/sprites/types';

// The station's rooms in pixel art (GDD §10, DESIGN_SYSTEM §8 septies): 40×28 scenes painted by rule on a steel wall,
// with a floor, a ceiling lamp and the room's machine. Each has two frames (a light that blinks, a beam that sweeps).
// A broken room is the same scene darkened, crossed by a crack and the Static's noise, which moves between frames.
// The refinery and the antenna grow with their level: more tanks filled, more dishes on the mast.

const W = 40;
const H = 28;
type Grid = string[][];

function room(): Grid {
  const g: Grid = [];
  for (let y = 0; y < H; y++) {
    const row: string[] = [];
    for (let x = 0; x < W; x++) {
      if (y <= 1) row.push('k');
      else if (y >= 25) row.push(y === 25 ? 'Y' : y === 26 ? 'T' : 'k');
      // Wall panels: a seam every 10 px and a rivet row.
      else row.push(x % 10 === 0 ? 'k' : y === 5 && x % 10 === 5 ? 'T' : 't');
    }
    g.push(row);
  }
  // Ceiling lamp.
  for (let x = 17; x <= 22; x++) g[2]![x] = 'Y';
  for (let x = 18; x <= 21; x++) g[3]![x] = 'w';
  return g;
}

const put = (g: Grid, x: number, y: number, k: string) => {
  if (x >= 0 && y >= 0 && x < W && y < H) g[y]![x] = k;
};
const rect = (g: Grid, x0: number, y0: number, x1: number, y1: number, k: string) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, k);
};
const disc = (g: Grid, cx: number, cy: number, r: number, k: string) => {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) put(g, x, y, k);
};
const ring = (g: Grid, cx: number, cy: number, r: number, k: string, width = 0.7) => {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) if (Math.abs(Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) < width) put(g, x, y, k);
};

/** A console: a steel desk with a green screen (bright in frame 0). */
const consoleAt = (g: Grid, x: number, f: number, screen = 'g') => {
  rect(g, x, 18, x + 7, 24, 'T');
  rect(g, x + 1, 19, x + 6, 21, f === 0 ? screen : 'G');
  rect(g, x, 24, x + 7, 24, 'k');
};

const SCENES: Record<RoomId, (g: Grid, f: number, level: number) => void> = {
  scanner: (g, f) => {
    // A dish on a pylon, its beam sweeping up.
    rect(g, 19, 16, 20, 24, 'T');
    ring(g, 20, 14, 7, 'Y', 0.9);
    disc(g, 20, 14, 5.5, 'i');
    disc(g, 20, 14, 2, 'c');
    for (let y = 2; y <= 8; y++) put(g, f === 0 ? 20 + Math.floor((8 - y) / 3) : 20 - Math.floor((8 - y) / 3), y, 'c');
    consoleAt(g, 2, f);
  },
  planetarium: (g, f) => {
    // A dome with a spiral galaxy inside.
    // A dark sky under a lilac rim, so the galaxy glows.
    disc(g, 20, 20, 13, 'a');
    disc(g, 20, 20, 12, 'k');
    for (let a = 0; a < 14; a++) {
      const t = a / 2 + f * 0.4;
      put(g, Math.round(20 + Math.cos(t) * a * 0.75), Math.round(17 + Math.sin(t) * a * 0.45), a < 4 ? 'w' : 'U');
      put(g, Math.round(20 - Math.cos(t) * a * 0.75), Math.round(17 - Math.sin(t) * a * 0.45), a < 4 ? 'w' : 'U');
    }
    rect(g, 6, 24, 34, 24, 'T');
  },
  lab: (g, f) => {
    // Benches with flasks of three colours, bubbling.
    rect(g, 3, 19, 36, 20, 'T');
    rect(g, 3, 21, 4, 24, 'T');
    rect(g, 35, 21, 36, 24, 'T');
    for (const [x, k] of [[7, 'g'], [15, 'q'], [23, 'c'], [30, 'g']] as const) {
      rect(g, x, 13, x + 3, 18, 'i');
      rect(g, x + 1, 15, x + 2, 18, k);
      put(g, x + 1 + f, 12, 'w');
    }
  },
  hangar: (g, f) => {
    // A probe on its platform between clamps, the bay door striped.
    for (let x = 1; x < W - 1; x++) put(g, x, 6, (x + f) % 4 < 2 ? 's' : 'k');
    rect(g, 10, 22, 30, 24, 'T');
    rect(g, 10, 22, 30, 22, 'Y');
    rect(g, 8, 14, 9, 21, 'Y');
    rect(g, 31, 14, 32, 21, 'Y');
    disc(g, 20, 17, 4.5, 'i');
    disc(g, 21, 17, 2, 'c');
    put(g, 15, 17, f === 0 ? 's' : 'o');
  },
  collider: (g, f) => {
    // A ring with two particles chasing each other.
    ring(g, 20, 15, 9, 'u', 1);
    ring(g, 20, 15, 9, 'U', 0.4);
    const a = f * Math.PI;
    put(g, Math.round(20 + Math.cos(a) * 9), Math.round(15 + Math.sin(a) * 9), 'w');
    put(g, Math.round(20 - Math.cos(a) * 9), Math.round(15 - Math.sin(a) * 9), 'c');
    rect(g, 2, 14, 10, 15, 'T');
    rect(g, 30, 14, 37, 15, 'T');
  },
  comms: (g, f) => {
    // Screens and a small dish.
    consoleAt(g, 4, f, 'c');
    consoleAt(g, 14, 1 - f, 'g');
    ring(g, 31, 12, 4, 'Y', 0.8);
    rect(g, 31, 15, 31, 24, 'T');
    put(g, 31, 12, f === 0 ? 'm' : 'n');
  },
  refinery: (g, f, level) => {
    // One tank per level, filled with molten material; pipes between them.
    const tanks = Math.max(1, Math.min(5, level));
    rect(g, 2, 9, 37, 9, 'T');
    for (let k = 0; k < tanks; k++) {
      const x = 3 + k * 7;
      rect(g, x, 10, x + 5, 24, 'T');
      rect(g, x + 1, 11, x + 4, 23, 'k');
      const fill = 18 - ((k + f) % 3);
      rect(g, x + 1, fill, x + 4, 23, 'o');
      rect(g, x + 1, fill, x + 4, fill, 's');
    }
  },
  antenna: (g, f, level) => {
    // A mast with one dish per level and a light that blinks.
    rect(g, 19, 6, 20, 24, 'T');
    const dishes = Math.max(1, Math.min(5, level));
    for (let k = 0; k < dishes; k++) {
      const y = 8 + k * 3.5;
      const left = k % 2 === 0;
      ring(g, left ? 13 : 26, y, 3, 'Y', 0.8);
      rect(g, left ? 15 : 21, Math.round(y), left ? 18 : 24, Math.round(y), 'T');
    }
    put(g, 19, 5, f === 0 ? 'm' : 'k');
    put(g, 20, 5, f === 0 ? 'm' : 'k');
  },
  archive: (g, f) => {
    // Shelves of data cubes, one lit.
    for (const y of [9, 15, 21]) {
      rect(g, 3, y + 3, 36, y + 3, 'T');
      for (let x = 4; x < 36; x += 4) rect(g, x, y, x + 2, y + 2, (x + y + f * 4) % 12 === 0 ? 'c' : 'U');
    }
  },
  trophies: (g, f) => {
    // Pedestals with cups.
    for (const [x, k] of [[7, 's'], [18, 'Y'], [29, 'o']] as const) {
      rect(g, x, 19, x + 4, 24, 'T');
      rect(g, x, 14, x + 4, 16, k);
      rect(g, x + 1, 17, x + 3, 17, k);
      put(g, x + 2, 18, k);
      if (f === 0) put(g, x + 1, 14, 'w');
    }
  },
};

/** Darker keys for a broken room. */
const DIM: Record<string, string> = { w: 'Y', i: 'b', c: 'b', g: 'h', G: 'h', s: 'r', o: 'r', q: 'Q', U: 'a', u: 'p', Y: 'T', T: 't', t: 'k', p: 'z', a: 'p', m: 'x', n: 'x', z: 'k', l: 'L' };

function broken(g: Grid, f: number): Grid {
  const out = g.map((row) => row.map((k) => DIM[k] ?? k));
  // A crack across the wall and the Static's noise, which moves between frames.
  for (let x = 4; x < 36; x++) put(out, x, 8 + Math.round(Math.sin(x / 3) * 2 + (x % 5 === 0 ? 1 : 0)), 'k');
  for (let y = 2; y < 25; y++)
    for (let x = 0; x < W; x++) {
      const h = (x * 73 + y * 151 + f * 97) % 41;
      if (h === 0) put(out, x, y, 'm');
      else if (h === 7) put(out, x, y, 'c');
    }
  return out;
}

const rows = (g: Grid) => g.map((r) => r.join(''));

function scene(id: RoomId, state: 'working' | 'broken', level: number): SpriteDef {
  const frames = [0, 1].map((f) => {
    const g = room();
    SCENES[id](g, f, level);
    return rows(state === 'broken' ? broken(g, f) : g);
  });
  return { w: W, h: H, fps: state === 'broken' ? 6 : 2, anchor: [0.5, 0.5], palette: P, frames };
}

/** The sprite id of a room in a state (the refinery and the antenna by level). */
export function roomSprite(id: RoomId, state: 'working' | 'broken', level: number): string {
  if (state === 'broken') return `room-${id}-broken`;
  return id === 'refinery' || id === 'antenna' ? `room-${id}-${Math.max(1, Math.min(5, level))}` : `room-${id}`;
}

const IDS: RoomId[] = ['scanner', 'planetarium', 'lab', 'hangar', 'collider', 'comms', 'refinery', 'antenna', 'archive', 'trophies'];

export const STATION_SPRITES: Record<string, SpriteDef> = Object.fromEntries([
  ...IDS.map((id) => [roomSprite(id, 'broken', 1), scene(id, 'broken', 1)]),
  ...IDS.filter((id) => id !== 'refinery' && id !== 'antenna').map((id) => [roomSprite(id, 'working', 1), scene(id, 'working', 1)]),
  ...(['refinery', 'antenna'] as const).flatMap((id) => [1, 2, 3, 4, 5].map((level) => [roomSprite(id, 'working', level), scene(id, 'working', level)])),
]);
