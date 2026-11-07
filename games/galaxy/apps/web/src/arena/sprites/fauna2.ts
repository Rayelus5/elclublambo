import { P } from './palette';
import type { SpriteDef } from './types';

// The fauna of the four M3b-3 sectors (DESIGN_SYSTEM §8 quater), drawn by rule: each species is a shape, three keys of
// its biome lit from the top left, a few hand-placed features (eyes, horns, spikes) and a 1 px outline. Two frames each:
// the second moves what makes the species itself (a tail, a spark, a tentacle), so the field never looks frozen.

const C: [number, number] = [0.5, 0.5];

/** Draws a sprite by rule: `fill` gives each pixel's key ('.' empty) and a 1 px outline wraps the shape. */
export function draw(w: number, h: number, fill: (x: number, y: number) => string): string[] {
  const g: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) row.push(fill(x, y));
    g.push(row);
  }
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && g[y]![x] !== '.';
  return g.map((row, y) =>
    row.map((ch, x) => (ch === '.' && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) ? 'k' : ch)).join(''),
  );
}

/** Light from the top left: the lit, mid or shade key by where the pixel sits from the centre. */
export function lit(x: number, y: number, cx: number, cy: number, r: number, keys: readonly [string, string, string]): string {
  const l = -(x + 0.5 - cx + (y + 0.5 - cy)) / r;
  return l > 0.45 ? keys[0] : l < -0.35 ? keys[2] : keys[1];
}

export const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => {
  const dx = (x + 0.5 - cx) / rx;
  const dy = (y + 0.5 - cy) / ry;
  return dx * dx + dy * dy <= 1;
};
export const dist = (x: number, y: number, cx: number, cy: number) => Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
/** Angle of a pixel around a centre, 0–2π. */
const angle = (x: number, y: number, cx: number, cy: number) => (Math.atan2(y + 0.5 - cy, x + 0.5 - cx) + Math.PI * 2) % (Math.PI * 2);
/** Whether angle `a` is within `width` of one of `n` evenly spaced rays starting at `turn`. */
const onRay = (a: number, n: number, turn: number, width: number) => {
  const step = (Math.PI * 2) / n;
  const off = (((a - turn) % step) + step) % step;
  return off < width || step - off < width;
};

const sprite = (w: number, h: number, fps: number, frames: string[][]): SpriteDef => ({ w, h, fps, anchor: C, palette: P, frames });
const ICE = ['w', 'i', 'b'] as const;
const STONE = ['Y', 'T', 't'] as const;
const CORAL = ['q', 'n', 'e'] as const;
const MIST = ['U', 'u', 'a'] as const;
const STEEL = ['Y', 'T', 't'] as const;
const GLITCH = ['v', 'V', 'p'] as const;

// ——— Anillos de Escarcha (ice) ———

/** Esquirla: a tumbling ice crystal; the glint runs along its edge. */
const splinter = (f: number) =>
  draw(8, 8, (x, y) => {
    if (Math.abs(x + 0.5 - 4) / 2.9 + Math.abs(y + 0.5 - 4) / 3.4 > 1) return '.';
    if ((f === 0 && x === 3 && y === 2) || (f === 1 && x === 4 && y === 3)) return 'w';
    return lit(x, y, 4, 4, 3, ['i', 'b', 'd']);
  });

/** Narval de escarcha: a long ice body, a horn forward and a fin that beats. */
const narwhal = (f: number) =>
  draw(16, 12, (x, y) => {
    if (y === 6 && x >= 12 && x <= 15) return x === 15 ? 'w' : 'i';
    if (y === 5 && x >= 12 && x <= 13) return 'w';
    if (x === 9 && y === 5) return 'k';
    const tail = f === 0 ? x >= 1 && x <= 2 && y >= 3 && y <= 9 && Math.abs(y - 6) <= 1 + (2 - x) * 1.5 : x >= 1 && x <= 2 && y >= 4 && y <= 10 && Math.abs(y - 7) <= 1 + (2 - x) * 1.5;
    if (tail) return 'b';
    if (!inEllipse(x, y, 7.5, 6.5, 5, 3.6)) return '.';
    if (y >= 8) return 'd';
    return lit(x, y, 7.5, 6, 4, ICE);
  });

/** Faro gélido: a frozen lighthouse with eight emitters; its core flares before the ring. */
const beacon = (f: number) =>
  draw(12, 12, (x, y) => {
    const d = dist(x, y, 6, 6);
    const a = angle(x, y, 6, 6);
    if (d <= (f === 0 ? 1.2 : 1.9)) return 'w';
    if (d <= 2.2) return 'c';
    if (d <= 3.9) return lit(x, y, 6, 6, 3.5, ['i', 'b', 'D']);
    if (d <= 5.1 && onRay(a, 8, Math.PI / 8, 0.2)) return f === 0 ? 'c' : 'i';
    return '.';
  });

/** Geoda: a rough stone split by a crystal vein that glows. */
const geode = (f: number) =>
  draw(12, 12, (x, y) => {
    const rough = (x * 7 + y * 3) % 5 === 0 ? 0.7 : 0;
    if (dist(x, y, 6, 6) > 4.9 - rough) return '.';
    if (Math.abs(x - y) <= 0 && dist(x, y, 6, 6) < 3.4) return f === 0 ? 'c' : 'w';
    if (Math.abs(x - y) === 1 && dist(x, y, 6, 6) < 2.6) return 'i';
    return lit(x, y, 6, 6, 4.5, STONE);
  });

/** Témpano: a slab of ice with a thick front plate (it gives only from behind, or to fire). */
const floe = (f: number) =>
  draw(16, 16, (x, y) => {
    const dx = Math.abs(x + 0.5 - 8);
    const dy = Math.abs(y + 0.5 - 8);
    if (dx > 6.5 || dy > 6.5 || dx + dy > 9.5) return '.';
    if (x >= 12) return y < 6 ? 'i' : 'D';
    if (dist(x, y, 7, 8) <= 1.5) return f === 0 ? 'c' : 'w';
    if (dist(x, y, 7, 8) <= 2.5) return 'd';
    return lit(x, y, 7, 7, 5.5, ICE);
  });

// ——— Arrecife Hueco (reef) ———

/** Pólipo: a coral bud with four little arms that turn. */
const polyp = (f: number) =>
  draw(8, 8, (x, y) => {
    const arms = f === 0 ? [[1, 1], [6, 1], [1, 6], [6, 6]] : [[3, 0], [7, 3], [4, 7], [0, 4]];
    if (arms.some(([ax, ay]) => ax === x && ay === y)) return 'q';
    if (dist(x, y, 4, 4) > 2.5) return '.';
    if (x === 3 && y === 3) return 'w';
    return lit(x, y, 4, 4, 2.2, CORAL);
  });

/** Medusa de bruma: a misty dome that glows green when it heals; the tentacles sway. */
const jelly = (f: number) =>
  draw(12, 12, (x, y) => {
    // Three tentacles that sway: each bends one pixel on alternate rows, the other way in the second frame.
    if (y >= 7 && y <= 10 && [3, 6, 9].some((tx, k) => tx + ((y + f + k) % 3 === 0 ? 1 : 0) === x)) return y === 10 ? 'g' : 'U';
    if (y > 6 || !inEllipse(x, y, 6, 6, 5, 5)) return '.';
    if (dist(x, y, 6, 4.5) <= 1.3) return f === 0 ? 'g' : 'w';
    if (y === 6) return 'a';
    return lit(x, y, 6, 4, 4, MIST);
  });

/** Erizo: a dark urchin whose spikes turn between volleys. */
const urchin = (f: number) =>
  draw(12, 12, (x, y) => {
    const d = dist(x, y, 6, 6);
    if (d <= 3.1) return x === 5 && y === 5 ? 'U' : lit(x, y, 6, 6, 3, ['u', 'p', 'z']);
    if (d <= 5.4 && onRay(angle(x, y, 6, 6), 8, f === 0 ? 0 : Math.PI / 8, 0.17)) return d > 4.6 ? 'w' : 'U';
    return '.';
  });

/** Anguila voltaica: a long yellow eel that snakes; sparks crackle over it before the lance. */
const eel = (f: number) =>
  draw(16, 12, (x, y) => {
    const mid = 6 + 2 * Math.sin(x / 2.4 + f * Math.PI);
    const head = x >= 11;
    const half = head ? 1.9 : 1.2;
    if (x >= 1 && x <= 14 && Math.abs(y + 0.5 - mid) <= half) {
      if (head && x === 13 && Math.abs(y + 0.5 - (mid - 0.6)) < 0.6) return 'k';
      return y + 0.5 < mid - 0.3 ? 's' : y + 0.5 > mid + 0.5 ? 'r' : 'o';
    }
    if (f === 1 && x % 4 === 1 && Math.abs(y + 0.5 - (mid - 3)) < 0.5) return 'c';
    return '.';
  });

/** Colonia: a lumpy coral mound full of nests where polyps are born; the nests glow in turn. */
const colony = (f: number) =>
  draw(16, 16, (x, y) => {
    const inside = inEllipse(x, y, 8, 9, 6.5, 5.5) || dist(x, y, 5, 5.5) <= 3.4 || dist(x, y, 11, 5) <= 3;
    if (!inside) return '.';
    const nests: [number, number][] = [[5, 6], [10, 10], [11, 5], [6, 11]];
    for (const [k, [nx, ny]] of nests.entries()) {
      const d = dist(x, y, nx + 0.5, ny + 0.5);
      if (d <= 0.9) return (k + f) % 2 === 0 ? 'g' : 'z';
      if (d <= 1.5) return 'Q';
    }
    return lit(x, y, 8, 8, 6, CORAL);
  });

// ——— Forja Rota (forge) ———

/** Ascua: a live ember with a white heart; the flame tip flickers. */
const ember = (f: number) =>
  draw(8, 8, (x, y) => {
    const tipX = f === 0 ? 4 : 3;
    if (y === 1 && x === tipX) return 'o';
    if (y === 2 && Math.abs(x + 0.5 - (tipX + 0.5)) <= 1) return 'l';
    const d = dist(x, y, 4, 4.6);
    if (d > 2.6) return '.';
    return d < 0.9 ? 'w' : d < 1.7 ? 's' : y > 4 ? 'l' : 'o';
  });

/** Ariete: a battering block with two horns forward, a red eye and vents that glow when it charges. */
const ram = (f: number) =>
  draw(16, 12, (x, y) => {
    if ((y === 3 || y === 8) && x >= 12 && x <= 14) return x === 14 ? 'w' : 'Y';
    if (x < 2 || x > 12 || y < 2 || y > 9) return '.';
    if ((x === 2 || x === 12) && (y === 2 || y === 9)) return '.';
    if (x === 10 && (y === 4 || y === 5)) return 'm';
    if (x === 4 && (y === 4 || y === 6)) return f === 0 ? 'o' : 's';
    return lit(x, y, 7, 6, 5, STEEL);
  });

/** Torreta corrupta: a squat turret with a red eye; the barrel's mouth glows as it aims. */
const sentry = (f: number) =>
  draw(12, 12, (x, y) => {
    if ((y === 5 || y === 6) && x >= 7 && x <= 11) return x === 11 && f === 1 ? 'n' : y === 5 ? 'T' : 't';
    const dx = Math.abs(x + 0.5 - 5.5);
    const dy = Math.abs(y + 0.5 - 6);
    if (dx > 4.2 || dy > 4.2 || dx + dy > 5.8) return '.';
    if (dist(x, y, 5.5, 6) <= 1.2) return f === 0 ? 'm' : 'n';
    return lit(x, y, 5.5, 6, 4, STEEL);
  });

/** Gólem de escoria: a hulk of slag with lava in its cracks (cold slows it to a crack). */
const golem = (f: number) =>
  draw(16, 16, (x, y) => {
    const rough = (x * 5 + y * 11) % 7 === 0 ? 0.8 : 0;
    const dx = Math.abs(x + 0.5 - 8);
    const dy = Math.abs(y + 0.5 - 8);
    if (Math.max(dx, dy) > 6.3 - rough || dx + dy > 10) return '.';
    // Lava in three jagged cracks from a hot core, brighter in the second frame.
    const d = dist(x, y, 8, 8);
    if (d < 1.6) return f === 0 ? 's' : 'w';
    const a = angle(x, y, 8, 8);
    const crack = [0.7, 2.6, 4.5].some((r) => Math.abs(((a - r + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.16 + ((x + y) % 2) * 0.08);
    if (crack && d < 5.6) return f === 0 ? 'o' : d < 3.5 ? 's' : 'o';
    return lit(x, y, 8, 8, 6, ['T', 't', 'L']);
  });

/** Soldadora: a round drone with a blue welding arc on top — the shield it lends. */
const welder = (f: number) =>
  draw(12, 12, (x, y) => {
    if (y <= 2) {
      const arc = f === 0 ? [[4, 2], [5, 1], [6, 1], [7, 2]] : [[3, 2], [5, 0], [6, 1], [8, 2]];
      if (arc.some(([ax, ay]) => ax === x && ay === y)) return f === 0 ? 'c' : 'w';
      return '.';
    }
    if ((x === 1 || x === 10) && (y === 7 || y === 8)) return 'T';
    if (dist(x, y, 6, 7) > 3.9) return '.';
    if (y === 6 && x >= 5 && x <= 7) return 'c';
    return lit(x, y, 6, 7, 3.5, STEEL);
  });

/** Crisol: a cauldron of molten metal; a bubble rises in the melt. */
const crucible = (f: number) =>
  draw(12, 12, (x, y) => {
    if (y >= 3 && y <= 4 && x >= 2 && x <= 9) {
      if (y === 3 && x === (f === 0 ? 4 : 7)) return 'w';
      return y === 3 ? 's' : 'o';
    }
    if (y < 5 || y > 10) return '.';
    if (!inEllipse(x, y, 6, 5, 4.6, 5.6)) return '.';
    if (y === 5) return 'Y';
    return lit(x, y, 6, 6, 4, STEEL);
  });

// ——— Fisura de la Señal (rift) ———

/** Glitch: a block of corrupt signal whose scanlines slip from side to side. */
const glitch = (f: number) =>
  draw(8, 8, (x, y) => {
    const slip = y % 2 === f ? 1 : 0;
    const sx = x - slip;
    if (y < 1 || y > 6 || sx < 1 || sx > 5) return '.';
    if (y === 3 && sx === 3) return 'w';
    if (y === 4) return 'c';
    return (sx + y) % 3 === 0 ? 'v' : 'V';
  });

/** Eco errante: a ghost of the old station's signal, with gaps in its scanlines and a ragged hem. */
const wraith = (f: number) =>
  draw(16, 16, (x, y) => {
    const hem = 12 + (Math.sin(x / 1.4 + f * Math.PI) > 0 ? 1 : 0);
    const head = inEllipse(x, y, 8, 6.5, 5.2, 5.2);
    const body = y >= 6 && y <= hem && x >= 3 && x <= 12;
    if (!head && !body) return '.';
    if (y === 9 || y === 11) return x % 2 === f ? '.' : 'u';
    if ((x === 6 || x === 9) && y === 6) return 'c';
    return lit(x, y, 8, 7, 5.5, MIST);
  });

/** Cantor de estática: a diamond with an antenna; when it sings, rings of signal leave it. */
const cantor = (f: number) =>
  draw(12, 12, (x, y) => {
    if (x === 6 && y <= 2) return y === 0 ? (f === 0 ? 'c' : 'w') : 'Y';
    const d = Math.abs(x + 0.5 - 6.5) + Math.abs(y + 0.5 - 7);
    if (d <= 3.4) return d <= 1 ? (f === 0 ? 'c' : 'w') : lit(x, y, 6.5, 7, 3, GLITCH);
    if (f === 1 && Math.abs(dist(x, y, 6.5, 7) - 5.2) < 0.45 && y > 3) return 'c';
    return '.';
  });

const two = (fn: (f: number) => string[]) => [fn(0), fn(1)];

export const FAUNA2: Record<string, SpriteDef> = {
  splinter: sprite(8, 8, 8, two(splinter)),
  narwhal: sprite(16, 12, 5, two(narwhal)),
  beacon: sprite(12, 12, 3, two(beacon)),
  geode: sprite(12, 12, 3, two(geode)),
  floe: sprite(16, 16, 3, two(floe)),
  polyp: sprite(8, 8, 6, two(polyp)),
  jelly: sprite(12, 12, 4, two(jelly)),
  urchin: sprite(12, 12, 3, two(urchin)),
  eel: sprite(16, 12, 6, two(eel)),
  colony: sprite(16, 16, 2, two(colony)),
  ember: sprite(8, 8, 10, two(ember)),
  ram: sprite(16, 12, 4, two(ram)),
  sentry: sprite(12, 12, 3, two(sentry)),
  golem: sprite(16, 16, 3, two(golem)),
  welder: sprite(12, 12, 8, two(welder)),
  crucible: sprite(12, 12, 3, two(crucible)),
  glitch: sprite(8, 8, 10, two(glitch)),
  wraith: sprite(16, 16, 4, two(wraith)),
  cantor: sprite(12, 12, 4, two(cantor)),
};
