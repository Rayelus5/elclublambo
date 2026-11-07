// Pixel art written as palette grids (plan ruling 10, DESIGN_SYSTEM §8 quater): each frame is a list of rows, one
// character per pixel; '.' is transparent and every other character is a key of the sprite's palette.

export interface SpriteDef {
  w: number;
  h: number;
  frames: string[][];
  palette: Record<string, string>;
  /** Frames per second of the loop (0: still). */
  fps: number;
  /** Pivot as a fraction of the size (0.5, 0.5: centre). */
  anchor: [number, number];
}

function hex(c: string): [number, number, number] {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGBA bytes of one frame, row by row. */
export function pixels(def: SpriteDef, frame: number): Uint8ClampedArray {
  const rows = def.frames[frame % def.frames.length]!;
  const out = new Uint8ClampedArray(def.w * def.h * 4);
  for (let y = 0; y < def.h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < def.w; x++) {
      const ch = row[x]!;
      if (ch === '.') continue;
      const [r, g, b] = hex(def.palette[ch]!);
      const i = (y * def.w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** One frame drawn on a canvas, each sprite pixel as a `scale`×`scale` square. */
export function rasterize(def: SpriteDef, frame: number, scale = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = def.w * scale;
  canvas.height = def.h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const img = new ImageData(def.w, def.h);
  img.data.set(pixels(def, frame));
  if (scale === 1) {
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  const one = document.createElement('canvas');
  one.width = def.w;
  one.height = def.h;
  one.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(one, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A grid from rows, checked to be rectangular at build time of the sprite tables (tests check them too). */
export function grid(...rows: string[]): string[] {
  return rows;
}
