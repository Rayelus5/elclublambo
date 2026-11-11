// The game's own cursor (open beta): a chrome sparkle in pixel art for every state (drawn in Aseprite,
// games/galaxy/art/cursor/cursor-cromo.aseprite), 24×24 cells drawn as crisp SVG at 1×, 2× or 3× and tinted with the
// player's colour (the chrome's reflection, the sparkles, the text beam, the sight, the help badge). It is applied with
// CSS variables on <html> (the CSP has no inline styles; `element.style` is fine and data: images are allowed) and
// remembered in this browser. Off, the system's cursor comes back.

export type CursorShape = 'default' | 'pointer' | 'press' | 'text' | 'notAllowed' | 'wait' | 'help' | 'grab' | 'grabbing' | 'aim';
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
export const CURSOR_SIZES: Record<CursorSize, number> = { small: 1, medium: 2, large: 3 };

const KEY = 'galaxy.cursor';
const DEFAULTS: CursorSettings = { on: true, size: 'medium', color: CURSOR_COLORS[0].hex };
const OUTLINE = '#0b0d26';
const SHADOW = '#05061a';

/**
 * Every state, 24×24 (an original set, after the owner's «cosmic chrome» brief):
 * - default: a four-point chrome star, its long point up and to the left is the tip; concave sides, an ice rim, a
 *   white sky band, a deep horizon line, violet below it and then the player's colour, with a dark outline and a soft
 *   shadow;
 * - pointer: the same star with a small sparkle and glints, over what can be pressed; press: it shrinks toward its tip;
 * - text: a beam between two small stars; notAllowed: a red «no» badge; wait: a comet circling; help: a «?» badge;
 * - grab: a small star with four arrows; grabbing: the arrows closer; aim: the arena's sight.
 * o outline · x soft shadow · W white · I ice · V violet · Y gold glint · f colour · H colour light · s colour dark
 * D colour deep · R red · r red dark (always) · . clear
 */
const GRIDS: Record<CursorShape, string[]> = {
  default: [
    '..o.....................',
    '.oHo....................',
    '..oHo...................',
    '..oHHo..................',
    '...oIHoo................',
    '...oIHIHoo....o.........',
    '...oIHHHIHooooHo........',
    '...oIHHWWWIIIHIox.......',
    '...oIWWWWDDDIooxx.......',
    '...oIWDDDVVVIoxx........',
    '...oIDVVVVfIoxx.........',
    '..oIVVVffffIox..........',
    '.ooIfffffffIox..........',
    'oHHIIIIIfffIox..........',
    '.oooooooHffIox..........',
    '..xxxxxxoHfIox..........',
    '.........oHIHo..........',
    '..........ooHox.........',
    '...........oHHo.........',
    '............oHox........',
    '.............oxx........',
    '..............x.........',
    '........................',
    '........................',
  ],
  pointer: [
    '..o.oWo..........oHo....',
    '.oHo.oo..........oHo....',
    '..oHoofo........oIHHo...',
    'o.oHHoo.......ooIWWWHoo.',
    'Wo.oIHoo.....oHHDDDDDHHo',
    'o..oIHIHoo....ooHVVVIoo.',
    'o..oIHHHIHooooHooHfIo...',
    'fo.oIHHWWWIIIHIoxoHo....',
    'o..oIWWWWDDDIooxxoHo....',
    '...oIWDDDVVVIoxx..o.....',
    '...oIDVVVVfIoxx.........',
    '..oIVVVffffIox..........',
    '.ooIfffffffIox..........',
    'oHHIIIIIfffIox..........',
    '.oooooooHffIox..........',
    '..xxxxxxoHfIox..........',
    '.........oHIHo..........',
    '..........ooHox.........',
    '...........oHHo.........',
    '............oHox........',
    '.............oxx........',
    '..............x.........',
    '........................',
    '........................',
  ],
  press: [
    '...oY...................',
    '..oHo.Y.................',
    '..oHox..................',
    '...oHo..................',
    'Y..oIHoo................',
    '...oIHIHoo...o..........',
    'Y..oIHHHIHoooHo.........',
    '...oIHWWWWIIHoxx........',
    '...oIWWDDDVIoxx.........',
    '...oIDDVVVfIox..........',
    '...oIVVVfffIox..........',
    '..oIIfffffIoxx..........',
    '.oHIoHIIffIox...........',
    '..ooxoooHffHo...........',
    '...xx.xxoHIIox..........',
    '.........ooHox..........',
    '..........oHHo..........',
    '...........oHox.........',
    '............oxx.........',
    '.............x..........',
    '........................',
    '........................',
    '........................',
    '........................',
  ],
  text: [
    '...........oHo..........',
    '...........oHox.........',
    '..........oIIox.........',
    '........ooIWWHoo........',
    '.......oHHIVVIHHo.......',
    '........oooHIoooxx......',
    '.........xoHHoxxx.......',
    '..........oHHox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHHox.........',
    '..........oHHox.........',
    '..........oIIox.........',
    '........ooIWWHoo........',
    '.......oHHIVVIHHo.......',
    '........oooHIoooxx......',
    '.........xxoHoxxx.......',
    '...........oHox.........',
  ],
  notAllowed: [
    '..o.....................',
    '.oHo....................',
    '..oHo...................',
    '..oIHoo.................',
    '..oHHIHoo...o...........',
    '...oIHHIHoooHo..........',
    '...oIHWWWIIHIox.........',
    '...oIWWDDDIooxx.........',
    '..oIDDDVVVIoxx..........',
    '..oIVVVfffIox...........',
    '.ooHIffffIoxx...oo......',
    'oHHooHIffIox.oooooooo...',
    '.ooxxooHIfHoooRRRRRRoo..',
    '..xx..xooHIooRRRRRRRRoo.',
    '........xoHorRWWRRRRRRo.',
    '.........oHorrRWWRRRRRo.',
    '..........oorrrRWWRRRRoo',
    '..........oorrrrRWWRRRoo',
    '...........orrrrrRWWRRo.',
    '...........orrrrrrRWWRo.',
    '...........oorrrrrrRRoo.',
    '............oorrrrrroo..',
    '.............oooooooo...',
    '................oo......',
  ],
  wait: [
    '..o.....................',
    '.oHo...........D........',
    '..oHo............D......',
    '..oIHoo.................',
    '..oHHIHoo...o......D....',
    '...oIHHIHoooHo..........',
    '...oIHWWWIIHIox.....s...',
    '...oIWWDDDIooxx.........',
    '..oIDDDVVVIoxx.......s..',
    '..oIVVVfffIox...........',
    '.ooHIffffIoxx........s..',
    'oHHooHIffIox............',
    '.ooxxooHIfHo.........f..',
    '..xx..xooHIox...........',
    '........xoHox.....o.....',
    '.........oHHo....oHo.f..',
    '..........oHox...oHo....',
    '...........oxx.ooIWHoo..',
    '............x.oHHDDDHHo.',
    '...............ooHVIoo..',
    '.................oHo....',
    '.................oHo....',
    '..................o.....',
    '........................',
  ],
  help: [
    '..o.....................',
    '.oHo....................',
    '..oHo...................',
    '..oIHoo.................',
    '..oHHIHoo...o...........',
    '...oIHHIHoooHo..........',
    '...oIHWWWIIHIox.........',
    '...oIWWDDDIooxx.........',
    '..oIDDDVVVIoxx..........',
    '..oIVVVHHHIox...........',
    '.ooHIHHHHIoxx...........',
    'oHHooHIHHIox...ooooo....',
    '.ooxxooHIHHo.ooHHHHHoo..',
    '..xx..xooHIoooHHHHHHfoo.',
    '........xoHooHHHooofffo.',
    '.........oHoHHHooHoofffo',
    '..........ooHHHHHfoofffo',
    '...........oHHHHfooffffo',
    '...........oHHHffofffffo',
    '...........oHHfffffffffo',
    '............offffoffffo.',
    '............oofffffffoo.',
    '.............oofffffoo..',
    '...............ooooo....',
  ],
  grab: [
    '........................',
    '........................',
    '............o...........',
    '...........ofo..........',
    '..........oHHHo.........',
    '.........oHHHHHo........',
    '..........ooHooxx.......',
    '...........oHoxx........',
    '..........oIIox.........',
    '.....o...oIHHHo...o.....',
    '....oHo.oIWWWWHo.oHo....',
    '...oHHooIWWWWWWHooHHo...',
    '..ofHHHHIDDDDDDIHHHHfo..',
    '...oHHoooHVVVVIoooHHoxx.',
    '....oHoxxoHffIoxxoHoxx..',
    '.....oxx..oHIoxx..oxx...',
    '......x....oHox....x....',
    '..........ooHoo.........',
    '.........oHHHHHo........',
    '..........oHHHoxx.......',
    '...........ofoxx........',
    '............oxx.........',
    '.............x..........',
    '........................',
  ],
  grabbing: [
    '........................',
    '........................',
    '........................',
    '........................',
    '............o...........',
    '...........ofo..........',
    '..........oHHHo.........',
    '.........oHHHHHo........',
    '..........oIIooxx.......',
    '.......o.oIHHHoxo.......',
    '......oHoIWWWWHoHo......',
    '.....oHHIWWWWWWHHHo.....',
    '....ofHHIDDDDDDIHHfo....',
    '.....oHHoHVVVVIoHHoxx...',
    '......oHooHffIooHoxx....',
    '.......oxxoHIooxoxx.....',
    '........xoHHHHHo.x......',
    '..........oHHHoxx.......',
    '...........ofoxx........',
    '............oxx.........',
    '.............x..........',
    '........................',
    '........................',
    '........................',
  ],
  aim: [
    '........................',
    '........................',
    '...........oo...........',
    '..........oHso..........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '...........oHox.........',
    '...oooooo.oIIoxoooooo...',
    '..oHHHHHHoIWWHoHHHHHHo..',
    '..ossssssHIVVIHssssssox.',
    '...ooooooooHIooooooooxx.',
    '....xxxxxxxoHoxxxxxxxx..',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '..........oHsox.........',
    '...........ooxx.........',
    '............xx..........',
    '........................',
  ],
};
/** Where each state points: the star's tip, or the centre for the beam, the arrows and the sight. */
const HOTSPOT: Record<CursorShape, [number, number]> = {
  default: [2, 0],
  pointer: [2, 0],
  press: [3, 0],
  text: [12, 12],
  notAllowed: [2, 0],
  wait: [2, 0],
  help: [2, 0],
  grab: [12, 12],
  grabbing: [12, 12],
  aim: [12, 12],
};
/** The system's own cursor for each, if an image cannot be used. */
const FALLBACK: Record<CursorShape, string> = {
  default: 'auto',
  pointer: 'pointer',
  press: 'pointer',
  text: 'text',
  notAllowed: 'not-allowed',
  wait: 'progress',
  help: 'help',
  grab: 'grab',
  grabbing: 'grabbing',
  aim: 'crosshair',
};
export const CURSOR_SHAPES = Object.keys(GRIDS) as CursorShape[];
/** The CSS variable of a state: --cursor-default, --cursor-not-allowed… */
export const cursorVar = (shape: CursorShape) => `--cursor-${shape.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

function mix(hex: string, to: number, k: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** One state as a crisp SVG data URL, `scale` screen pixels per cell. */
export function cursorSvg(shape: CursorShape, color: string, scale: number): string {
  const paint: Record<string, string> = {
    o: OUTLINE,
    x: SHADOW,
    W: '#ffffff',
    I: '#c6ecff',
    V: '#a991ff',
    Y: '#fff0b0',
    f: color,
    H: mix(color, 255, 0.55),
    s: mix(color, 0, 0.32),
    D: mix(color, 0, 0.58),
    R: '#ff3b5c',
    r: '#a3122f',
  };
  const rects: string[] = [];
  GRIDS[shape].forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === c) end++;
      // The shadow is see-through, so the star floats over whatever is below it.
      if (paint[c]) rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${paint[c]}"${c === 'x' ? ' fill-opacity="0.6"' : ''}/>`);
      x = end;
    }
  });
  const px = 24 * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" shape-rendering="crispEdges">${rects.join('')}</svg>`;
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
  if (!s.on) {
    root.classList.remove('custom-cursor');
    for (const shape of CURSOR_SHAPES) root.style.removeProperty(cursorVar(shape));
    return;
  }
  const scale = CURSOR_SIZES[s.size];
  for (const shape of CURSOR_SHAPES) {
    const [hx, hy] = HOTSPOT[shape];
    root.style.setProperty(cursorVar(shape), `url("${cursorSvg(shape, s.color, scale)}") ${hx * scale} ${hy * scale}, ${FALLBACK[shape]}`);
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
