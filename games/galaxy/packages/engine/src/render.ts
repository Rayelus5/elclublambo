import { backgroundField } from './background';
import { loadPalette, luminance, type Palette, type Rgb } from './color';
import { POSTFX, RENDER, VISUALS } from './config/generated';
import type { PhenomenonVisual, PostfxConfig, PostfxOverride, Traits } from './config/types';
import { buildParams, galaxyField, type GalaxyField } from './fields';
import { smoothstep } from './noise';
import { galaxyMatter, glitch, lightLayer } from './phenomena';
import { BrailleGrid, dither, toText } from './raster';
import { subRng } from './rng/generator';
import { subSeed32 } from './rng/seed';
import { backgroundStars, galaxyStars, glintCenters } from './stars';
import { drawTraits } from './traits';

// pipeline.render_traits (ENGINE_PORT §1.2): traits → fields → phenomena → braille dots, colours and radii.
// The image itself (glow, vignette, tonemap, CRT) is composed from `dotColor`/`dotRadius` by src/gpu.
const fr = Math.fround;
const TWO_PI = 2 * Math.PI;

export type Lod = 192 | 96 | 48;

export interface RenderOptions {
  columns: Lod;
  width?: number;
  height?: number;
}

export interface BrailleRender {
  columns: number;
  rows: number;
  nx: number;
  ny: number;
  /** Dot pitch in px. */
  step: number;
  oy: number;
  width: number;
  height: number;
  /** 1 where a dot is on, row-major (nx × ny). */
  on: Uint8Array;
  /** Linear HDR colour per dot (0 where off), float32, n × 3. */
  dotColor: Float32Array;
  /** Dot radius in px (−1 where off). */
  dotRadius: Float32Array;
  text: string;
  palette: { key: string; inverted: boolean; angular: boolean; background: Rgb; accent: Rgb };
  postfx: PostfxConfig;
}

/** The global post-processing with the palette's (or phenomenon's) own settings on top; glow merges key by key. */
export function postfxFor(base: PostfxConfig, override: PostfxOverride): PostfxConfig {
  const merged = { ...base, ...override } as PostfxConfig;
  if (override.glow) return { ...merged, glow: { ...base.glow, ...override.glow } };
  return merged;
}

/** Linear colour of each galaxy dot (can exceed 1 in the core: HDR), float32 like `galaxy_color`. */
export function galaxyColor(field: GalaxyField, palette: Palette): Float32Array {
  const n = field.t.length;
  const out = new Float32Array(3 * n);
  const detail = palette.detail;
  const lumDetail = detail ? luminance(detail[0], detail[1], detail[2]) : 0;
  const c = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const t = field.t[k]!;
    if (palette.angular) {
      const hue = field.theta[k]! / TWO_PI + field.radius[k]! * 0.9;
      const s = palette.sampleCyclic(hue);
      const m = 0.35 + 0.65 * t;
      const white = Math.pow(t, 3) * 0.8;
      for (let ch = 0; ch < 3; ch++) c[ch] = s[ch]! * m * (1 - white) + white;
    } else {
      const s = palette.sample(palette.inverted ? 0.45 + 0.55 * t : 0.12 + 0.88 * t);
      c[0] = s[0];
      c[1] = s[1];
      c[2] = s[2];
    }
    if (detail) {
      // Secondary colour in the star-forming regions and the outer halo, as bright as the base colour.
      let w = palette.detailRegions * smoothstep(0.2, 0.6, field.young[k]!) * (1 - smoothstep(0.7, 0.9, t));
      w = Math.max(w, palette.detailHalo * (1 - smoothstep(0.08, 0.4, t)));
      // luminance(color) is float32 for the float32 LUT colours (no palette is both angular and detailed).
      const ratio = fr(luminance(c[0]!, c[1]!, c[2]!) / lumDetail);
      for (let ch = 0; ch < 3; ch++) c[ch] = c[ch]! * (1 - w) + fr(detail[ch]! * ratio) * w;
    }
    if (!palette.inverted) {
      const hdr = 1 + 1.5 * smoothstep(0.85, 1.0, t);
      for (let ch = 0; ch < 3; ch++) c[ch] = c[ch]! * hdr;
    }
    for (let ch = 0; ch < 3; ch++) out[3 * k + ch] = c[ch]!;
  }
  return out;
}

export function renderBraille(traits: Traits, seed: bigint, opts: RenderOptions): BrailleRender {
  const width = opts.width ?? RENDER.width;
  const height = opts.height ?? RENDER.height;
  const bcfg = RENDER.braille;
  const grid = new BrailleGrid(width, height, opts.columns);
  const { nx, ny } = grid;
  const n = nx * ny;
  const { u: u1, v: v1 } = grid.dotUv();
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      u[j * nx + i] = u1[i]!;
      v[j * nx + i] = v1[j]!;
    }
  }
  const palette = loadPalette(traits.palette);
  const density = VISUALS.star_density[traits.star_density]!;
  const bgSpec = VISUALS.background[traits.background]!;
  const phenomenon = traits.phenomenon ?? 'none';
  const phSpec: PhenomenonVisual = VISUALS.phenomenon[phenomenon] ?? {};
  const phRng = subRng(seed, 'phenomenon');
  const phSeed = subSeed32(seed, 'phenomenon');

  // What the galaxy is: traits → parameters → density field (with the matter a phenomenon adds).
  const params = buildParams(traits, seed, grid.snap(0.0, 0.0));
  const matter = galaxyMatter(phenomenon, u, v, params, phSpec, phRng, phSeed);
  const gal = galaxyField(u, v, params, RENDER.density_gain, grid.uvStep, matter);
  const bg = backgroundField(u, v, traits.background, bgSpec, palette, subSeed32(seed, 'background'), subRng(seed, 'background'));
  const light = lightLayer(phenomenon, u, v, params, palette, phSpec, phRng, grid, phSeed);

  // How it is drawn: braille dithering of the combined density.
  const galColor = galaxyColor(gal, palette);
  const t = new Float64Array(n);
  const color = new Float64Array(3 * n);
  for (let k = 0; k < n; k++) {
    const g = gal.t[k]!;
    const tb = bg.t[k]!;
    let tk = Math.max(g, tb);
    const weight = g / Math.max(g + tb, 1e-6); // soft mix of galaxy and background
    for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = galColor[3 * k + ch]! * weight + bg.color[3 * k + ch]! * (1 - weight);
    if (light) {
      // The phenomenon's light wins where it is brighter than what lies below.
      const lt = light.t[k]!;
      const l2 = fr(lt * lt);
      const w = l2 / Math.max(l2 + tk * tk, 1e-6);
      for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = color[3 * k + ch]! * (1 - w) + light.color[3 * k + ch]! * w;
      tk = Math.max(tk, lt);
    }
    t[k] = tk;
  }
  // On paper there is no glow to fill in: the same presence needs more ink dots.
  const tDots = palette.inverted ? t.map((x) => Math.pow(x, 0.7)) : t;
  const on = dither(tDots, nx, bcfg.dither_jitter, bcfg.min_density, subRng(seed, 'dither'));

  const rngStars = subRng(seed, 'stars');
  const far = backgroundStars(n, bgSpec.stars, palette, rngStars);
  for (let k = 0; k < n; k++) {
    // Background stars cover neither the galaxy nor the phenomenon.
    if (far.mask[k] && !(gal.t[k]! < 0.1 && (light ? light.t[k]! : 0) < 0.05)) far.mask[k] = 0;
  }
  const near = galaxyStars(gal.t, gal.young, density.stars, palette, rngStars);
  for (const layer of [far, near]) {
    for (let k = 0; k < n; k++) {
      if (!layer.mask[k]) continue;
      on[k] = 1;
      color[3 * k] = layer.color[3 * k]!;
      color[3 * k + 1] = layer.color[3 * k + 1]!;
      color[3 * k + 2] = layer.color[3 * k + 2]!;
    }
  }

  const dotR = bcfg.dot_radius * grid.cellW;
  const radius = new Float32Array(n).fill(dotR);
  const bigR = fr(bcfg.glint_radius * grid.cellW);
  const accent = palette.accent;
  const glintBase = accent.map((a) => fr(fr(a * 0.5) + 0.5));
  for (const [row, col, big] of glintCenters(gal.t, nx, density.glints, subRng(seed, 'glints'))) {
    const reach = big ? 2 : 1;
    const cross: Array<[number, number]> = [[0, 0]];
    for (const s of [-1, 1]) for (let d = 1; d <= reach; d++) cross.push([d * s, 0]);
    for (const s of [-1, 1]) for (let d = 1; d <= reach; d++) cross.push([0, d * s]);
    for (const [dy, dx] of cross) {
      const y = row + dy;
      const x = col + dx;
      if (y < 0 || y >= ny || x < 0 || x >= nx) throw new RangeError(`glint cross outside the grid at (${y}, ${x})`);
      const k = y * nx + x;
      on[k] = 1;
      radius[k] = bigR;
      if (palette.inverted) {
        for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = accent[ch]!;
      } else {
        const gain = fr(dy === 0 && dx === 0 ? 3.0 : 1.2 / Math.max(Math.abs(dx), Math.abs(dy)));
        for (let ch = 0; ch < 3; ch++) color[3 * k + ch] = fr(glintBase[ch]! * gain);
      }
    }
  }

  let postfx = postfxFor(POSTFX, palette.postfx);
  let finalColor: Float64Array | Float32Array = color;
  if (phenomenon === 'anomaly') {
    const color32 = Float32Array.from(color);
    glitch(on, color32, radius, nx, ny, palette, phSpec, phRng, dotR);
    finalColor = color32;
    postfx = postfxFor(postfx, (phSpec['postfx'] ?? {}) as PostfxOverride);
  }

  const dotColor = new Float32Array(3 * n);
  const dotRadius = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (on[k]) {
      dotColor[3 * k] = finalColor[3 * k]!;
      dotColor[3 * k + 1] = finalColor[3 * k + 1]!;
      dotColor[3 * k + 2] = finalColor[3 * k + 2]!;
      dotRadius[k] = radius[k]!;
    } else {
      dotRadius[k] = -1;
    }
  }
  return {
    columns: opts.columns,
    rows: grid.rows,
    nx,
    ny,
    step: grid.step,
    oy: grid.oy,
    width,
    height,
    on,
    dotColor,
    dotRadius,
    text: toText(on, nx, ny),
    palette: { key: palette.key, inverted: palette.inverted, angular: palette.angular, background: palette.background, accent },
    postfx,
  };
}

/** Draws the traits from the seed (stream "traits", with optional fixed values) and renders them. */
export function renderFromSeed(seed: bigint, opts: RenderOptions & { fixed?: Partial<Traits> }): BrailleRender & { traits: Traits } {
  const traits = drawTraits(subRng(seed, 'traits'), opts.fixed);
  return { ...renderBraille(traits, seed, opts), traits };
}
