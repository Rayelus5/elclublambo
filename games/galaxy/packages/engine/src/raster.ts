// render/braille.py (ENGINE_PORT §1.3 and §6): the braille dot grid. Each character is a 2×4 cell of dots.

export class BrailleGrid {
  readonly cellW: number;
  readonly cellH: number;
  readonly rows: number;
  /** Dot pitch in px. */
  readonly step: number;
  readonly nx: number;
  readonly ny: number;
  /** Vertical margin when the rows do not fill the height exactly. */
  readonly oy: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly columns: number,
  ) {
    this.cellW = width / columns;
    this.cellH = 2 * this.cellW;
    this.rows = Math.floor(height / this.cellH); // int(height // cell_h)
    this.step = this.cellW / 2;
    this.nx = 2 * columns;
    this.ny = 4 * this.rows;
    this.oy = (height - this.rows * this.cellH) / 2;
  }

  /** Dot centres in screen coordinates [-1, 1]: `u` per column (nx), `v` per row (ny). */
  dotUv(): { u: Float64Array; v: Float64Array } {
    const u = new Float64Array(this.nx);
    const v = new Float64Array(this.ny);
    for (let i = 0; i < this.nx; i++) u[i] = ((i + 0.5) * this.step) / this.width * 2 - 1;
    for (let j = 0; j < this.ny; j++) v[j] = (this.oy + (j + 0.5) * this.step) / this.height * 2 - 1;
    return { u, v };
  }

  get uvStep(): number {
    return (2 * this.step) / this.width;
  }

  /** Snaps a screen point to the centre of the nearest braille dot. */
  snap(u: number, v: number): [number, number] {
    const i = Math.min(Math.max(Math.floor((((u + 1) / 2) * this.width) / this.step), 0), this.nx - 1);
    const j = Math.min(Math.max(Math.floor((((v + 1) / 2) * this.height - this.oy) / this.step), 0), this.ny - 1);
    return [((i + 0.5) * this.step) / this.width * 2 - 1, (this.oy + (j + 0.5) * this.step) / this.height * 2 - 1];
  }
}

/** Ordered 4×4 Bayer thresholds, (m + 0.5) / 16; tiled so bayer[y][x] = BAYER4[y % 4][x % 4]. */
export const BAYER4: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((m) => (m + 0.5) / 16));

/**
 * Turns each dot on when its density beats a Bayer 4×4 threshold mixed with some randomness:
 * threshold = (1 − jitter)·bayer + jitter·U (one double per dot, row-major); on = t > minDensity && t·1.1 > threshold.
 */
export function dither(t: Float64Array, nx: number, jitter: number, minDensity: number, rng: { randomArray(n: number): Float64Array }): Uint8Array {
  const n = t.length;
  const ny = n / nx;
  const noise = rng.randomArray(n);
  const on = new Uint8Array(n);
  const keep = 1 - jitter;
  for (let j = 0; j < ny; j++) {
    const bayerRow = BAYER4[j % 4]!;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const threshold = keep * bayerRow[i % 4]! + jitter * noise[k]!;
      const tk = t[k]!;
      on[k] = tk > minDensity && tk * 1.1 > threshold ? 1 : 0;
    }
  }
  return on;
}

// Bit of each dot inside a cell (row 0-3, column 0-1), as in Unicode U+2800.
const BRAILLE_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

/** The dots as Unicode braille text: one line per row of cells, LF, no trailing newline. */
export function toText(on: Uint8Array, nx: number, ny: number): string {
  const rows = Math.floor(ny / 4);
  const cols = Math.floor(nx / 2);
  const lines: string[] = [];
  const codes = new Array<number>(cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let code = 0;
      for (let j = 0; j < 4; j++) {
        const base = (4 * r + j) * nx + 2 * c;
        const bits = BRAILLE_BITS[j]!;
        if (on[base]) code += bits[0];
        if (on[base + 1]) code += bits[1];
      }
      codes[c] = 0x2800 + code;
    }
    lines.push(String.fromCharCode(...codes));
  }
  return lines.join('\n');
}
