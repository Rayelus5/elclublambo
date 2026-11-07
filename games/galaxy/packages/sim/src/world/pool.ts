// Struct-of-arrays entity pools (GDD §18.4): one typed array per field, an `alive` flag and a generation per slot.
// Slots are reused (lowest free first) and a reused slot is zeroed, so nothing leaks from its previous occupant; the
// generation goes up on every reuse, so the renderer can tell a new entity from the old one in the same slot.

export type FieldKind = 'f64' | 'i32' | 'u8' | 'u16';

type ArrayOf<K extends FieldKind> = K extends 'f64' ? Float64Array : K extends 'i32' ? Int32Array : K extends 'u16' ? Uint16Array : Uint8Array;

export type Fields = Record<string, FieldKind>;

export type PoolArrays<F extends Fields> = { readonly [K in keyof F]: ArrayOf<F[K]> };

export interface PoolBase {
  readonly cap: number;
  readonly alive: Uint8Array;
  readonly gen: Uint16Array;
  /** Live entities. */
  count: number;
  /** One past the highest slot ever used: iterate `for (let i = 0; i < top; i++) if (alive[i]) …`. */
  top: number;
  /** A free slot (the lowest), zeroed and marked alive; −1 when the pool is full. */
  spawn(): number;
  kill(i: number): void;
}

export type Pool<F extends Fields> = PoolBase & PoolArrays<F>;

function makeArray(kind: FieldKind, cap: number): Float64Array | Int32Array | Uint8Array | Uint16Array {
  switch (kind) {
    case 'f64':
      return new Float64Array(cap);
    case 'i32':
      return new Int32Array(cap);
    case 'u16':
      return new Uint16Array(cap);
    case 'u8':
      return new Uint8Array(cap);
  }
}

export function createPool<F extends Fields>(cap: number, fields: F): Pool<F> {
  const arrays: Record<string, Float64Array | Int32Array | Uint8Array | Uint16Array> = {};
  for (const [name, kind] of Object.entries(fields)) arrays[name] = makeArray(kind, cap);
  const all = Object.values(arrays);
  const alive = new Uint8Array(cap);
  const gen = new Uint16Array(cap);
  let low = 0;
  const pool: PoolBase = {
    cap,
    alive,
    gen,
    count: 0,
    top: 0,
    spawn() {
      for (let i = low; i < cap; i++) {
        if (alive[i]) continue;
        alive[i] = 1;
        gen[i] = (gen[i]! + 1) & 0xffff;
        for (const a of all) a[i] = 0;
        pool.count++;
        low = i + 1;
        if (i + 1 > pool.top) pool.top = i + 1;
        return i;
      }
      low = cap;
      return -1;
    },
    kill(i) {
      if (!alive[i]) return;
      alive[i] = 0;
      pool.count--;
      if (i < low) low = i;
    },
  };
  return Object.assign(pool, arrays) as Pool<F>;
}
