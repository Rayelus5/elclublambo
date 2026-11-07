// Uniform spatial hash for neighbour queries. Results are candidates (whole cells), in a fixed order: cells row by
// row (y, then x, ascending), and inside a cell in insertion order. The simulation relies on that order being the same
// on every machine.

export class SpatialGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly used: number[][] = [];

  constructor(readonly cell = 48) {}

  private key(cx: number, cy: number): number {
    // 2^21 cells per axis around the origin: ±50 million units at 48 per cell.
    return (cx + 1048576) * 2097152 + (cy + 1048576);
  }

  clear(): void {
    for (const list of this.used) list.length = 0;
    this.used.length = 0;
    // The plane is endless: forget empty cells once too many have been visited.
    if (this.cells.size > 8192) this.cells.clear();
  }

  insert(i: number, x: number, y: number): void {
    const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    let list = this.cells.get(k);
    if (!list) {
      list = [];
      this.cells.set(k, list);
    }
    if (list.length === 0) this.used.push(list);
    list.push(i);
  }

  /** Writes the candidates within `r` of (x, y) into `out` and returns how many. */
  query(x: number, y: number, r: number, out: number[]): number {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c);
    const x1 = Math.floor((x + r) / c);
    const y0 = Math.floor((y - r) / c);
    const y1 = Math.floor((y + r) / c);
    let n = 0;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const list = this.cells.get(this.key(cx, cy));
        if (!list) continue;
        for (let j = 0; j < list.length; j++) out[n++] = list[j]!;
      }
    }
    return n;
  }
}
