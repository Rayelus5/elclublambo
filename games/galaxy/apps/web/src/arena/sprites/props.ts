import { draw, inEllipse, lit } from './fauna2';
import { P } from './palette';
import type { SpriteDef } from './types';

// Breakable props of the ground (SIM 1.7.0, DESIGN_SYSTEM §8 quater): a deposit per biome in three sizes, outlined and
// lit from the top left like the fauna, with veins of ore in the biome's accent that catch the light. They read as
// "something to break" over the faint ground, and stay quieter than the fauna (no Static red, no Terminal green: those
// belong to warnings and data).

const C: [number, number] = [0.5, 0.5];
const still = (rows: string[]): SpriteDef => ({ w: rows[0]!.length, h: rows.length, fps: 0, anchor: C, palette: P, frames: [rows] });

type Vein = [number, number, number, number];

/** A lump of the biome's rock, with ore veins along the given segments (pixel coordinates). */
function deposit(w: number, h: number, body: readonly [string, string, string], vein: string, veins: readonly Vein[], glint: string): string[] {
  const cx = w / 2;
  const cy = h / 2 + 0.5;
  return draw(w, h, (x, y) => {
    if (!inEllipse(x, y, cx, cy, w / 2 - 1, h / 2 - 1.2)) return '.';
    for (const [x0, y0, x1, y1] of veins) {
      const len2 = (x1 - x0) ** 2 + (y1 - y0) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x + 0.5 - x0) * (x1 - x0) + (y + 0.5 - y0) * (y1 - y0)) / len2));
      const d = Math.hypot(x + 0.5 - (x0 + (x1 - x0) * t), y + 0.5 - (y0 + (y1 - y0) * t));
      // The vein's lit end shines.
      if (d < 0.65) return t < 0.2 ? glint : vein;
    }
    return lit(x, y, cx, cy, w / 2.6, body);
  });
}

/** Three sizes of one biome's deposit. */
function set(id: string, body: readonly [string, string, string], vein: string, glint: string): Record<string, SpriteDef> {
  return {
    [`prop-${id}-1`]: still(deposit(16, 13, body, vein, [[4, 4, 9, 8], [10, 5, 12, 9]], glint)),
    [`prop-${id}-2`]: still(deposit(13, 11, body, vein, [[4, 4, 8, 7]], glint)),
    [`prop-${id}-3`]: still(deposit(19, 15, body, vein, [[4, 5, 8, 10], [9, 4, 14, 7], [11, 9, 15, 11]], glint)),
  };
}

export const PROPS: Record<string, SpriteDef> = {
  // Steel rock with cyan ore (the nebula), ice with white seams, coral with teal, slag with lava, rift glass with glitch.
  ...set('nebula', ['Y', 'T', 't'], 'c', 'w'),
  ...set('ice', ['i', 'b', 'd'], 'w', 'w'),
  ...set('reef', ['q', 'Q', 'z'], 'j', 'w'),
  ...set('forge', ['T', 't', 'L'], 'l', 's'),
  ...set('rift', ['U', 'u', 'p'], 'v', 'w'),
};
