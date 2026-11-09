// The game's own cursor (open beta): cartoon pixel art for every state (drawn in Aseprite, games/galaxy/art/cursor/),
// 24×24 cells drawn as crisp SVG at 1×, 2× or 3× and tinted with the player's colour (the glove's cuff, the tap
// marks, the text beam, the sight, the help badge). It is applied with CSS variables on <html> (the CSP has no inline
// styles; `element.style` is fine and data: images are allowed) and remembered in this browser. Off, the system's
// cursor comes back.

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

/**
 * Every state, 24×24:
 * - default: a cartoon white glove pointing up (a long index finger lit on its left, three curled fingers stepping
 *   down, the thumb, shading right and below, a rolled cuff in the colour with its shine and a double shadow);
 * - pointer: the same glove with tap marks round the fingertip, over what can be pressed; press: the finger sinks;
 * - text: an outlined I-beam; notAllowed: a red «no» badge; wait: an hourglass; help: a «?» badge;
 * - grab: an open glove; grabbing: a fist; aim: the arena's sight.
 * o outline · x drop shadow · h shine · w glove · l soft shade · g deep shade · C cuff light · c cuff · d cuff dark
 * t tap marks · f colour · H colour light · s colour dark · W white · R red (always) · . clear
 */
const GRIDS: Record<CursorShape, string[]> = {
  default: [
    '........oooo............',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwwwwwwwlo',
    '...owwwlwwwwwwwwwwwwwwlo',
    '...owwlwwwwwwwwwwwwwwlgo',
    '....owlwwwwwwwwwwwwwwlgo',
    '.....olwwwwwwwwwwwwwlgo.',
    '.....oglllllllllllllggo.',
    '.....oooooooooooooooooo.',
    '.....oCCCCCCCCCCCCCCCco.',
    '.....occcccccccccccccdo.',
    '.....oddddddddddddddddo.',
    '.....oooooooooooooooooo.',
    '......xxxxxxxxxxxxxxxxx.',
  ],
  pointer: [
    '....t...oooo...t........',
    '.....t.ohwwlo.t.........',
    '.......ohwwlo...........',
    '...tt..ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwwwwwwwlo',
    '...owwwlwwwwwwwwwwwwwwlo',
    '...owwlwwwwwwwwwwwwwwlgo',
    '....owlwwwwwwwwwwwwwwlgo',
    '.....olwwwwwwwwwwwwwlgo.',
    '.....oglllllllllllllggo.',
    '.....oooooooooooooooooo.',
    '.....oCCCCCCCCCCCCCCCco.',
    '.....occcccccccccccccdo.',
    '.....oddddddddddddddddo.',
    '.....oooooooooooooooooo.',
    '......xxxxxxxxxxxxxxxxx.',
  ],
  press: [
    '.........tt.............',
    '.....t........t.........',
    '......t......t..........',
    '........oooo............',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwwwwwwwlo',
    '...owwwlwwwwwwwwwwwwwwlo',
    '...owwlwwwwwwwwwwwwwwlgo',
    '....owlwwwwwwwwwwwwwwlgo',
    '.....olwwwwwwwwwwwwwlgo.',
    '.....oglllllllllllllggo.',
    '.....oooooooooooooooooo.',
    '.....oCCCCCCCCCCCCCCCco.',
    '.....occcccccccccccccdo.',
    '.....oddddddddddddddddo.',
    '.....oooooooooooooooooo.',
    '......xxxxxxxxxxxxxxxxx.',
  ],
  text: [
    '........................',
    '......oooooooooooo......',
    '......oHHHHffffffo......',
    '......offfssssfffo......',
    '......oooooffooooo......',
    '..........offo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........oHfo..........',
    '..........offo..........',
    '......oooooffooooo......',
    '......oHHHffffsffo......',
    '......offfssssfffo......',
    '......oooooooooooo......',
    '.......xxxxxxxxxxxx.....',
    '........................',
  ],
  notAllowed: [
    '........oooo............',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwoooowwlo',
    '...owwwlwwwwwwooRRRRoolo',
    '...owwlwwwwwwooRWWWWRooo',
    '....owlwwwwwwoRRWWWWWRoo',
    '.....olwwwwwoRWWRWWWWWRo',
    '.....ogllllloRWWWRWWWWRo',
    '.....ooooooooRWWWWRWWWRo',
    '.....oCCCCCCoRWWWWWRWWRo',
    '.....occcccccoRWWWWWRRo.',
    '.....odddddddooRWWWWRoo.',
    '.....oooooooooooRRRRooo.',
    '......xxxxxxxxxxooooxxx.',
  ],
  wait: [
    '........oooo............',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwwwwwwwlo',
    '...owwwlwwwwwwwooooooooo',
    '...owwlwwwwwwwwoHffffffo',
    '....owlwwwwwwwwooooooooo',
    '.....olwwwwwwwwwoWWWWWo.',
    '.....oglllllllllloWWWoo.',
    '.....ooooooooooooooWooo.',
    '.....oCCCCCCCCCCCofWfoo.',
    '.....occccccccccofWWWfo.',
    '.....odddddddddoooooooo.',
    '.....oooooooooooHffffffo',
    '......xxxxxxxxxooooooooo',
  ],
  help: [
    '........oooo............',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwlo...........',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwoooowwlo',
    '...owwwlwwwwwwoossssoolo',
    '...owwlwwwwwwoosWWWWsooo',
    '....owlwwwwwwosWWffWWsoo',
    '.....olwwwwwosfffffWWfso',
    '.....oglllllosfffWWWffso',
    '.....oooooooosfffWWfffso',
    '.....oCCCCCCosffffffffso',
    '.....occcccccosffWWffso.',
    '.....odddddddoosffffsoo.',
    '.....ooooooooooossssooo.',
    '......xxxxxxxxxxooooxxx.',
  ],
  grab: [
    '..........oooo..........',
    '......ooo.ohwlo.ooo.....',
    '.....ohwlo.ohwlo.ohwlo..',
    '.....ohwlo.ohwlo.ohwlo..',
    '.....ohwlo.ohwlo.ohwlo..',
    '.....ohwlo.ohwlo.ohwlo..',
    '.....ohwlooohwloohwwlo..',
    '.....ohwwlowwwwlowwwlo..',
    '.....ohwwwwwwwwwwwwwwlo.',
    '.oo..ohwwwwwwwwwwwwwwlo.',
    'ohwo.owwwwwwwwwwwwwwwlo.',
    'ohwwoowwwwwwwwwwwwwwwlo.',
    '.ohwwwwwwwwwwwwwwwwwwlo.',
    '..ohwwwwwwwwwwwwwwwwlgo.',
    '...owwwwwwwwwwwwwwwwlgo.',
    '....owwwwwwwwwwwwwwwlgo.',
    '.....olwwwwwwwwwwwwlgo..',
    '.....ogllllllllllllggo..',
    '.....oooooooooooooooooo.',
    '.....oCCCCCCCCCCCCCCCco.',
    '.....occcccccccccccccdo.',
    '.....oddddddddddddddddo.',
    '.....oooooooooooooooooo.',
    '......xxxxxxxxxxxxxxxxx.',
  ],
  grabbing: [
    '........................',
    '........................',
    '........................',
    '........................',
    '........................',
    '........oooo............',
    '.......ohwwloooo........',
    '.......ohwwlohwloooo....',
    '.......ohwwlowwlohwlooo.',
    '.......ohwwlowwwgwwlohlo',
    '....oooohwwlgwwwgwwwgwlo',
    '...ohwwowwwwwwwwwwwwwwlo',
    '...ohwwgwwwwwwwwwwwwwwlo',
    '...owwwlwwwwwwwwwwwwwwlo',
    '...owwlwwwwwwwwwwwwwwlgo',
    '....owlwwwwwwwwwwwwwwlgo',
    '.....olwwwwwwwwwwwwwlgo.',
    '.....oglllllllllllllggo.',
    '.....oooooooooooooooooo.',
    '.....oCCCCCCCCCCCCCCCco.',
    '.....occcccccccccccccdo.',
    '.....oddddddddddddddddo.',
    '.....oooooooooooooooooo.',
    '......xxxxxxxxxxxxxxxxx.',
  ],
  aim: [
    '..........oooo..........',
    '..........offo..........',
    '..........offo..........',
    '........oooffooo........',
    '......ooffoffoffoo......',
    '.....offHooffoofffo.....',
    '....ofHHo.offo.offfo....',
    '....ofHo..offo..offo....',
    '...ofHo...offo...offo...',
    '...ofo....oooo....ofo...',
    'oooooooooooooooooooooooo',
    'offffffffooWWooffffffffo',
    'offffffffooWWooffffffffo',
    'oooooooooooooooooooooooo',
    '...ofo....oooo....oso...',
    '...offo...offo...ofso...',
    '....offo..offo..ofso....',
    '....offfo.offo.offso....',
    '.....offfooffoofsso.....',
    '......ooffoffossoo......',
    '........oooffooo........',
    '..........offo..........',
    '..........offo..........',
    '..........oooo..........',
  ],
};
/** Where each state points: the fingertip, or the centre for the beam, the open hand, the fist and the sight. */
const HOTSPOT: Record<CursorShape, [number, number]> = {
  default: [9, 0],
  pointer: [9, 0],
  press: [9, 0],
  text: [12, 12],
  notAllowed: [9, 0],
  wait: [9, 0],
  help: [9, 0],
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
    x: '#05061a',
    h: '#ffffff',
    w: '#eef1ff',
    l: '#cfd6f2',
    g: '#9aa4cf',
    C: mix(color, 255, 0.4),
    c: color,
    d: mix(color, 0, 0.3),
    t: color,
    f: color,
    H: mix(color, 255, 0.5),
    s: mix(color, 0, 0.3),
    W: '#ffffff',
    R: '#ff3b5c',
  };
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
