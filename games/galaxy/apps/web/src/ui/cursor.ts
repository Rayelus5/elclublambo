// The game's own cursor (open beta): cartoon pixel art (a white glove pointing up, the same glove tapping over what
// can be pressed, a sight for the arena), 16×16 cells drawn as crisp SVG at 2×, 3× or 4× and tinted with the player's colour (fill,
// a lighter edge, a darker shade, a navy outline). It is applied with CSS variables on <html> (the CSP has no
// inline styles; `element.style` is fine and data: images are allowed) and remembered in this browser. Off, the
// system's cursor comes back.

export type CursorShape = 'arrow' | 'hand' | 'aim';
export type CursorSize = 'small' | 'medium' | 'large';
export interface CursorSettings {
  on: boolean;
  size: CursorSize;
  color: string;
}

export const CURSOR_COLORS = [
  { id: 'solar', hex: '#ffc94a' },
  { id: 'ice', hex: '#6fe3ff' },
  { id: 'terminal', hex: '#45e3a6' },
  { id: 'nova', hex: '#ff6b7a' },
  { id: 'uv', hex: '#b39dff' },
  { id: 'white', hex: '#f4f6ff' },
  { id: 'orange', hex: '#ff9d2e' },
  { id: 'blue', hex: '#6fb7ff' },
] as const;
export type CursorColorId = (typeof CURSOR_COLORS)[number]['id'];
export const CURSOR_SIZES: Record<CursorSize, number> = { small: 2, medium: 3, large: 4 };

const KEY = 'galaxy.cursor';
const DEFAULTS: CursorSettings = { on: true, size: 'medium', color: CURSOR_COLORS[0].hex };
const OUTLINE = '#0b0d26';

// A cartoon white glove (puffy fingers, a thumb, a cuff in the player's colour) pointing up with its index finger;
// over what can be pressed, the same glove with little «tap» marks round the fingertip.
// o: outline · w: glove white · g: glove shade · c: cuff (the colour) · d: cuff shade · t: tap marks (the colour)
// f: fill and h/s/w for the arena's sight · .: clear
const GLOVE = [
  '....ooo',
  '...owwwo',
  '...owwwo',
  '...owwgo',
  '...owwgoooo',
  '...owwgowwwoooo',
  '.ooowwgowwgowwwo',
  'owwwowwwwwwowwgo',
  'owwwwwwwwwwwwwgo',
  'owwwwwwwwwwwwwgo',
  '.owwwwwwwwwwwwgo',
  '.owwwwwwwwwwwggo',
  '..owwwwwwwwwggo',
  '..occcccccccco',
  '..odccccccccdo',
  '..oooooooooooo',
];
const GLOVE_TAP = GLOVE.map((row, y) => {
  // Three short strokes round the fingertip: up-left, left and up-right.
  const marks: Record<number, number[]> = { 0: [1, 9], 1: [0, 10], 3: [0, 1] };
  const cells = row.padEnd(16, '.').split('');
  for (const x of marks[y] ?? []) if (cells[x] === '.') cells[x] = 't';
  return cells.join('');
});
/** A ring with four ticks and a dot in the middle, worked out rather than drawn. */
function aimGrid(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const tickV = (x === 7 || x === 8) && (y <= 2 || y >= 13);
      const tickH = (y === 7 || y === 8) && (x <= 2 || x >= 13);
      const dot = (x === 7 || x === 8) && (y === 7 || y === 8);
      if (dot) row += 'w';
      else if (tickV || tickH) row += 'f';
      else if (d >= 4.6 && d < 5.8) row += 'f';
      else if ((d >= 3.8 && d < 4.6) || (d >= 5.8 && d < 6.6)) row += 'o';
      else if ((x === 6 || x === 9) && (y === 7 || y === 8)) row += 'o';
      else if ((y === 6 || y === 9) && (x === 7 || x === 8)) row += 'o';
      else row += '.';
    }
    rows.push(row);
  }
  return rows;
}
const GRIDS: Record<CursorShape, string[]> = { arrow: GLOVE, hand: GLOVE_TAP, aim: aimGrid() };
const HOTSPOT: Record<CursorShape, [number, number]> = { arrow: [5, 0], hand: [5, 0], aim: [8, 8] };
const FALLBACK: Record<CursorShape, string> = { arrow: 'auto', hand: 'pointer', aim: 'crosshair' };

function mix(hex: string, to: number, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** One shape as a crisp SVG data URL, `scale` screen pixels per cell. */
export function cursorSvg(shape: CursorShape, color: string, scale: number): string {
  const paint: Record<string, string> = { o: OUTLINE, f: color, h: mix(color, 255, 0.5), s: mix(color, 0, 0.35), w: '#ffffff', g: '#c9d0ea', c: color, d: mix(color, 0, 0.3), t: color };
  const rects: string[] = [];
  GRIDS[shape].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      if (paint[c]) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${paint[c]}"/>`);
      x = end;
    }
  });
  const px = 16 * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects.join('')}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function readCursor(): CursorSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CursorSettings> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
    return {
      on: typeof raw.on === 'boolean' ? raw.on : DEFAULTS.on,
      size: raw.size === 'small' || raw.size === 'medium' || raw.size === 'large' ? raw.size : DEFAULTS.size,
      color: CURSOR_COLORS.some((c) => c.hex === raw.color) ? raw.color! : DEFAULTS.color,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Puts the cursor on the whole page (or takes it off). */
export function applyCursor(s: CursorSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars: [string, CursorShape][] = [
    ['--cursor-default', 'arrow'],
    ['--cursor-pointer', 'hand'],
    ['--cursor-aim', 'aim'],
  ];
  if (!s.on) {
    root.classList.remove('custom-cursor');
    for (const [v] of vars) root.style.removeProperty(v);
    return;
  }
  const scale = CURSOR_SIZES[s.size];
  for (const [v, shape] of vars) {
    const [hx, hy] = HOTSPOT[shape];
    root.style.setProperty(v, `url("${cursorSvg(shape, s.color, scale)}") ${hx * scale} ${hy * scale}, ${FALLBACK[shape]}`);
  }
  root.classList.add('custom-cursor');
}

/** Saves a change, applies it at once and returns the new settings. */
export function saveCursor(next: Partial<CursorSettings>): CursorSettings {
  const s = { ...readCursor(), ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private windows: the choice lasts for this page only.
  }
  applyCursor(s);
  return s;
}
