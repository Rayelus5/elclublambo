import { type ColorVisionMode, PALETTES } from '../../a11y/color-vision';

// The arena's meaningful colours as Pixi numbers (plan «escáner pro», part C), from the colour-blind palettes: danger
// (warnings, elite rings, the boss's bar), good (friendly zones, revive), the hurt flash, the four players and the
// elements — each element also with a 3×3 glyph, so an enemy's mark never relies on colour alone. The decorative
// colours (an enemy's death burst, the lighthouse's warm beam) stay as they are.

export interface StagePalette {
  danger: number;
  good: number;
  bad: number;
  hurt: number;
  team: readonly number[];
  element: Record<string, number>;
  /** Each element's mark as 9 cells, row by row ('1' lit). */
  glyph: Record<string, string>;
}

const num = (hex: string) => Number.parseInt(hex.slice(1), 16);

export const ELEMENT_GLYPH: Record<string, string> = {
  burn: '010111111',
  slow: '111010111',
  corrosion: '101010101',
  shock: '011010110',
  hack: '111101111',
  leech: '010111010',
  breach: '100010001',
  chain: '101111101',
  pure: '000010000',
  prism: '010101010',
  invert: '111000111',
};

const cache = new Map<ColorVisionMode, StagePalette>();

export function stagePalette(mode: ColorVisionMode): StagePalette {
  let p = cache.get(mode);
  if (!p) {
    const v = PALETTES[mode];
    p = {
      danger: num(v.static),
      good: num(v.terminal[0]),
      bad: num(v.nova[0]),
      hurt: mode === 'none' ? 0xff5a6e : num(v.nova[0]),
      team: v.team.map(num),
      element: Object.fromEntries(Object.entries(v.element).map(([k, c]) => [k, num(c)])),
      glyph: ELEMENT_GLYPH,
    };
    cache.set(mode, p);
  }
  return p;
}

/** A co-op player's colour (probe index), for the HUD and the marks as much as for the stage. */
export function teamTint(index: number, mode: ColorVisionMode): number {
  const team = stagePalette(mode).team;
  return team[index % team.length]!;
}
