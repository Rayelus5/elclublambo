import { Rectangle, Texture, TextureSource } from 'pixi.js';
import { pixels, SPRITES, type SpriteDef } from '../sprites';

// One texture atlas for every sprite frame (DESIGN_SYSTEM §8 quater), plus a white silhouette of each frame for the
// hit flash and the Static glitch copies (a tint can darken a texture, never whiten it). Nearest sampling: pixels
// stay square at any zoom.

export interface Atlas {
  frames: Record<string, Texture[]>;
  white: Record<string, Texture[]>;
  pixel: Texture;
  defs: Record<string, SpriteDef>;
  destroy(): void;
}

const PAD = 1;
const WIDTH = 512;

function whiteOf(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = 255;
  }
  return out;
}

export function buildAtlas(): Atlas {
  // Shelf packing, two copies (colour, white) of every frame.
  type Slot = { id: string; frame: number; white: boolean; x: number; y: number; def: SpriteDef };
  const slots: Slot[] = [];
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  const ids = Object.keys(SPRITES).sort((a, b) => SPRITES[b]!.h - SPRITES[a]!.h);
  for (const id of ids) {
    const def = SPRITES[id]!;
    for (let f = 0; f < def.frames.length; f++) {
      for (const white of [false, true]) {
        if (x + def.w + PAD > WIDTH) {
          x = PAD;
          y += shelf + PAD;
          shelf = 0;
        }
        slots.push({ id, frame: f, white, x, y, def });
        x += def.w + PAD;
        shelf = Math.max(shelf, def.h);
      }
    }
  }
  // A 1×1 white pixel for particles and lines, at the end.
  const pixelAt = { x: PAD, y: y + shelf + PAD };
  const height = pixelAt.y + 2;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  for (const s of slots) {
    const rgba = pixels(s.def, s.frame);
    const img = new ImageData(s.def.w, s.def.h);
    img.data.set(s.white ? whiteOf(rgba) : rgba);
    ctx.putImageData(img, s.x, s.y);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(pixelAt.x, pixelAt.y, 1, 1);

  const source = TextureSource.from(canvas);
  source.scaleMode = 'nearest';
  const frames: Record<string, Texture[]> = {};
  const white: Record<string, Texture[]> = {};
  for (const s of slots) {
    const tex = new Texture({ source, frame: new Rectangle(s.x, s.y, s.def.w, s.def.h), defaultAnchor: { x: s.def.anchor[0], y: s.def.anchor[1] } });
    const list = (s.white ? white : frames)[s.id] ?? [];
    list[s.frame] = tex;
    (s.white ? white : frames)[s.id] = list;
  }
  const pixel = new Texture({ source, frame: new Rectangle(pixelAt.x, pixelAt.y, 1, 1) });
  return {
    frames,
    white,
    pixel,
    defs: SPRITES,
    destroy() {
      source.destroy();
    },
  };
}

/** A dithered texture drawn by a per-pixel rule (nebula clouds, the starfield, the side bars). */
export function ditherTexture(w: number, h: number, paint: (x: number, y: number) => string | null): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = paint(x, y);
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const source = TextureSource.from(canvas);
  source.scaleMode = 'nearest';
  source.addressMode = 'repeat';
  return new Texture({ source });
}

/**
 * A grey mask, one byte per pixel (0 clear, else that grey, opaque), tinted when drawn: the Núcleo's storm cloud in
 * the nebula's shape (environment.ts). Written through ImageData, so it costs little next to the noise it copies.
 */
export function maskTexture(w: number, h: number, grey: Uint8Array): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const g = grey[i]!;
    if (!g) continue;
    img.data[i * 4] = g;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const source = TextureSource.from(canvas);
  source.scaleMode = 'nearest';
  source.addressMode = 'repeat';
  return new Texture({ source });
}

/** Bayer 4×4 threshold (0–15). */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise that repeats every `period` cells (seamless when tiled). */
export function periodicNoise(x: number, y: number, cell: number, period: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash2(w(x0), w(y0), seed);
  const b = hash2(w(x0 + 1), w(y0), seed);
  const c = hash2(w(x0), w(y0 + 1), seed);
  const d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Three octaves of periodic noise in [0, 1] over a `size`×`size` tile. */
export function fbm(x: number, y: number, size: number, seed: number): number {
  let total = 0;
  let amp = 0.55;
  let cells = 3;
  for (let o = 0; o < 3; o++) {
    total += amp * periodicNoise(x, y, size / cells, cells, seed + o * 101);
    amp *= 0.5;
    cells *= 2;
  }
  return total / 0.9625;
}
