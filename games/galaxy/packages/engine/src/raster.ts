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
