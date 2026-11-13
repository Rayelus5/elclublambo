import type { Tier } from '@galaxy/shared';

// The colour-blind palettes (plan «escáner pro», part C; the owner: «un modo completo para daltónicos»). Only the
// colours that mean something change — rarity, good against danger, the four players, the elements — never the
// galaxies' art. Each palette was chosen by simulation (Machado, Oliveira & Fernandes 2009, full severity) so that, as
// a colour-blind player sees them, every pair of a group stays apart (ΔE2000 ≥ 12) and readable on the game's dark
// background (contrast ≥ 3:1); test/color-vision.test.ts checks it. Red/green blindness (protan, deutan) moves meaning
// onto the blue–orange axis (Okabe–Ito style); blue/yellow blindness (tritan) onto red–teal. Shapes back the
// colours wherever colour alone would tell (the elements' glyphs, the rarity pips, dashed arcs). The «Mítica» card is
// iridescent (styles/app.css); its solid colour here is only for dots, small text, bars and tables, chosen the same
// way (ΔE2000 ≥ 18 from the other five in every mode, and ≥ 4.5:1 on every panel).

export type ColorVisionMode = 'none' | 'protan' | 'deutan' | 'tritan';

/** A family of tokens: base, its darker step, its lip, and the ink that sits on it. */
type Family = readonly [string, string, string, string];

export interface VisionPalette {
  tier: Record<Tier, string>;
  /** Good, healing, ready (the design's Terminal). */
  terminal: Family;
  /** Bad, hurt (the design's Nova). */
  nova: Family;
  /** Danger: enemy warnings and attacks (the Static). */
  static: string;
  /** The four players of a group. */
  team: readonly [string, string, string, string];
  element: Record<string, string>;
}

const BASE_ELEMENTS: Record<string, string> = {
  burn: '#ff9a3c',
  slow: '#6fb7ff',
  corrosion: '#45e3a6',
  shock: '#b39dff',
  hack: '#ffc94a',
  leech: '#ff4d6d',
  breach: '#17b07e',
  chain: '#6fe3ff',
  pure: '#f3f5ff',
  prism: '#ffc94a',
  invert: '#7259ee',
};

const REDGREEN: VisionPalette = {
  tier: { common: '#d7dbea', uncommon: '#3fb8ff', rare: '#7b6bff', epic: '#ff8a3d', legendary: '#ffe45c', mythic: '#f080a0' },
  terminal: ['#4fb3ff', '#2f8fe0', '#1d5a9a', '#04203a'],
  nova: ['#ff8a1f', '#e06d00', '#9a4500', '#2b1400'],
  static: '#ff6a00',
  team: ['#ffd23f', '#3fa9ff', '#f3f5ff', '#ff7a1a'],
  element: { ...BASE_ELEMENTS, corrosion: '#8fe8ff', leech: '#ff4fd8', breach: '#cfd8ff', burn: '#ff8a1f', slow: '#3fa9ff' },
};

export const PALETTES: Record<ColorVisionMode, VisionPalette> = {
  none: {
    tier: { common: '#c9d0ea', uncommon: '#45e3a6', rare: '#6fb7ff', epic: '#b39dff', legendary: '#ffc94a', mythic: '#ff4fd8' },
    terminal: ['#45e3a6', '#17b07e', '#0b7352', '#04281c'],
    nova: ['#ff6b7a', '#e8435a', '#9c2238', '#2b0712'],
    static: '#ff4d6d',
    team: ['#ffc94a', '#45e3a6', '#bfe3ff', '#ff6b7a'],
    element: BASE_ELEMENTS,
  },
  protan: REDGREEN,
  deutan: REDGREEN,
  tritan: {
    tier: { common: '#d0d4e4', uncommon: '#2ee6b8', rare: '#ff5f8f', epic: '#c48bff', legendary: '#ffb03a', mythic: '#8888ff' },
    terminal: ['#3fe0b0', '#17b08a', '#0b7360', '#04281c'],
    nova: ['#ff6b7a', '#e8435a', '#9c2238', '#2b0712'],
    static: '#ff4d6d',
    team: ['#ffd23f', '#3fe0b0', '#f3f5ff', '#ff6b7a'],
    element: { ...BASE_ELEMENTS, slow: '#ff9ad5', chain: '#3fe0b0', breach: '#d0d4e4', hack: '#ffd23f', prism: '#ff5f8f' },
  },
};

/** A tier's colour for this mode (for code that draws outside CSS: canvases, three.js, Pixi). */
export function tierHex(tier: Tier, mode: ColorVisionMode): string {
  return PALETTES[mode].tier[tier];
}

/** The design's light tone of each tier, for sparks drawn bright then deep. */
const SPARK_LIGHT: Record<Tier, string> = { common: '#ffffff', uncommon: '#d8fff0', rare: '#e6f3ff', epic: '#f1ebff', legendary: '#fff8e0', mythic: '#ffe6f8' };

/** A tier's sparks (bright, then deep) for this mode: «Normal» keeps the design's pairs, a palette lightens its own tier. */
export function tierSparks(tier: Tier, mode: ColorVisionMode): [string, string] {
  const deep = tierHex(tier, mode);
  if (mode === 'none') return [SPARK_LIGHT[tier], deep];
  const n = Number.parseInt(deep.slice(1), 16);
  const light = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c + (255 - c) * 0.78).toString(16).padStart(2, '0'));
  return [`#${light.join('')}`, deep];
}

/** The CSS tokens a mode replaces (its value, or the design's own when the mode is «Normal»). */
export function cssTokens(mode: ColorVisionMode): Record<string, string> | null {
  if (mode === 'none') return null;
  const p = PALETTES[mode];
  const family = (name: string, f: Family) => ({ [`--color-${name}`]: f[0], [`--color-${name}-2`]: f[1], [`--color-${name}-lip`]: f[2], [`--color-on-${name}`]: f[3] });
  return {
    ...Object.fromEntries(Object.entries(p.tier).map(([t, c]) => [`--color-tier-${t}`, c])),
    ...family('terminal', p.terminal),
    ...family('nova', p.nova),
    '--color-static': p.static,
  };
}

/** Every token any mode may set (to clear them when going back to «Normal»). */
export const CSS_TOKENS = Object.keys(cssTokens('deutan')!);

// ---- Simulation and colour difference (for the tests and the settings' preview). ----

const MACHADO: Record<Exclude<ColorVisionMode, 'none'>, number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
};
function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const hex = (c: readonly number[]) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;

/** How a colour looks to someone with this colour blindness (full severity). */
export function simulate(color: string, mode: ColorVisionMode): string {
  if (mode === 'none') return color.toLowerCase();
  const m = MACHADO[mode];
  const [r, g, b] = rgb(color).map(toLinear) as [number, number, number];
  return hex([m[0]! * r + m[1]! * g + m[2]! * b, m[3]! * r + m[4]! * g + m[5]! * b, m[6]! * r + m[7]! * g + m[8]! * b].map(toSrgb));
}

function lab(color: string): [number, number, number] {
  const [r, g, b] = rgb(color).map(toLinear) as [number, number, number];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 colour difference (about 1: just noticeable; 12 and more: clearly different). */
export function deltaE(a: string, b: string): number {
  const [L1, a1, b1] = lab(a);
  const [L2, a2, b2] = lab(b);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (x: number, y: number) => {
    const d = Math.atan2(y, x) / rad;
    return d < 0 ? d + 360 : d;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a: string, b: string): number {
  const L = (c: string) => {
    const [r, g, bl] = rgb(c).map(toLinear) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
