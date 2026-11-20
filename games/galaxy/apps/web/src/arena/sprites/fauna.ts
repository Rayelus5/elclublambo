import { P } from './palette';
import { grid, type SpriteDef } from './types';

// The Static's fauna (DESIGN_SYSTEM §8 quater; the probes are in probe-art.ts). Hand-drawn grids, light from the top left, 1 px
// outline. Every species has its own hue so it reads at a glance.

const C: [number, number] = [0.5, 0.5];

export const MITE: SpriteDef = {
  w: 8,
  h: 8,
  fps: 8,
  anchor: C,
  palette: P,
  frames: [
    grid('k......k', '.k.kk.k.', '..kmmk..', '.kmnnmk.', 'kmnwcnmk', 'kmnnnnmk', '.kxmmxk.', '.k.kk.k.'),
    grid('.k....k.', '.k.kk.k.', '..kmmk..', '.kmnnmk.', 'kmnwcnmk', 'kmnnnnmk', '.kxmmxk.', 'k..kk..k'),
  ],
};

export const CELLET: SpriteDef = {
  w: 7,
  h: 7,
  fps: 6,
  anchor: C,
  palette: P,
  frames: [
    grid('..kkk..', '.kUUUk.', 'kUmmUUk', 'kUmnUUk', 'kUUUUwk', '.kuUuk.', '..kkk..'),
    grid('..kkk..', '.kUUUk.', 'kUUmmUk', 'kUUnmUk', 'kUUUUwk', '.kuUuk.', '..kkk..'),
  ],
};

export const CELL: SpriteDef = {
  w: 12,
  h: 12,
  fps: 4,
  anchor: C,
  palette: P,
  frames: [
    grid(
      '....kkkk....',
      '..kkUUUUkk..',
      '.kUUUUUUUwk.',
      '.kUUppUUUUk.',
      'kUUpmmpUUUUk',
      'kUUpmnmpUUUk',
      'kUUpmmmpUUUk',
      'kUUUpppUUUUk',
      'kUUUUUUUUUuk',
      '.kUUUUUUUuk.',
      '..kkuuuukk..',
      '....kkkk....',
    ),
    grid(
      '....kkkk....',
      '..kkUUUUkk..',
      '.kUUUUUUUwk.',
      '.kUUppUUUUk.',
      'kUUpmmpUUUUk',
      'kUUpmwmpUUUk',
      'kUUpmmmpUUUk',
      'kUUUpppUUUUk',
      'kUUUUUUUUUuk',
      '.kUUUUUUUuk.',
      '..kkuuuukk..',
      '....kkkk....',
    ),
  ],
};

export const RAY: SpriteDef = {
  w: 16,
  h: 12,
  fps: 6,
  anchor: C,
  palette: P,
  frames: [
    grid(
      '................',
      '..kk............',
      '.kDDk...........',
      '.kDbDkk.........',
      '..kDbbDkkkk.....',
      '...kDbbbbmmkk...',
      '...kDbbbbmmcmk..',
      '...kDbbbbmmkk...',
      '..kDbbDkkkk.....',
      '.kDbDkk.........',
      '.kDDk...........',
      '..kk............',
    ),
    grid(
      '................',
      '................',
      '..kk............',
      '.kDbkk..........',
      '..kDbbDkkkk.....',
      '...kDbbbbmmkk...',
      '...kDbbbbmmcmk..',
      '...kDbbbbmmkk...',
      '..kDbbDkkkk.....',
      '.kDbkk..........',
      '..kk............',
      '................',
    ),
  ],
};

export const SPITTER: SpriteDef = {
  w: 12,
  h: 12,
  fps: 3,
  anchor: C,
  palette: P,
  frames: [
    grid(
      '....kkkk....',
      '...kossok...',
      '..kosoosok..',
      '.kooxzzxook.',
      '.kosxmmxsok.',
      'kooxmwmmxook',
      'kooxmmmmxook',
      '.kooxxxxook.',
      '.krroooorrk.',
      '..krroorrk..',
      '...kkrrkk...',
      '....k..k....',
    ),
    grid(
      '....kkkk....',
      '...kossok...',
      '..kosoosok..',
      '.kooxzzxook.',
      '.kosxzzxsok.',
      'kooxzmmzxook',
      'kooxmmmmxook',
      '.kooxxxxook.',
      '.krroooorrk.',
      '..krroorrk..',
      '...kkrrkk...',
      '....k..k....',
    ),
  ],
};

export const SHELL: SpriteDef = {
  w: 16,
  h: 16,
  fps: 5,
  anchor: C,
  palette: P,
  frames: [
    grid(
      '................',
      '.....kkkkkk.....',
      '...kkTTTTTTkk...',
      '..kTTYYTTYYTTk..',
      '.kTYYTTttTTYYTk.',
      '.kTTtkkkkkktTTk.',
      'kTTtkmmmmmmktTTk',
      'kTYtkmnwnnmktYTk',
      'kTYtkmnnnnmktYTk',
      'kTTtkmmmmmmktTTk',
      '.kTTtkkkkkktTTk.',
      '.kTYYTTttTTYYTk.',
      '..kTTYYTTYYTTk..',
      '...kkTTTTTTkk...',
      '..k..kkkkkk..k..',
      '.k............k.',
    ),
    grid(
      '................',
      '.....kkkkkk.....',
      '...kkTTTTTTkk...',
      '..kTTYYTTYYTTk..',
      '.kTYYTTttTTYYTk.',
      '.kTTtkkkkkktTTk.',
      'kTTtkmmmmmmktTTk',
      'kTYtkmnnwnmktYTk',
      'kTYtkmnnnnmktYTk',
      'kTTtkmmmmmmktTTk',
      '.kTTtkkkkkktTTk.',
      '.kTYYTTttTTYYTk.',
      '..kTTYYTTYYTTk..',
      '...kkTTTTTTkk...',
      '.k...kkkkkk...k.',
      'k..............k',
    ),
  ],
};

/** The Static Core «La Colmena Rota»: a cracked hive, drawn by rule (40×40), with a pulsing core. */
function hive(core: number): string[] {
  const n = 40;
  const c = 19.5;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 19.6) {
        row += '.';
        continue;
      }
      if (d > 18.4) {
        row += 'k';
        continue;
      }
      if (d < core) {
        row += d < core * 0.45 ? 'w' : d < core * 0.75 ? 's' : 'o';
        continue;
      }
      // Cracks of the Static: three jagged rays from the core.
      const ang = Math.atan2(dy, dx);
      const crack = [0.4, 2.5, 4.3].some((a) => {
        const da = Math.abs(((ang - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        return da < 0.07 + (Math.floor(d) % 3 === 0 ? 0.05 : 0);
      });
      if (crack && d < 17) {
        row += d < core + 3 ? 'w' : 'c';
        continue;
      }
      // Hexagonal cells: walls on a staggered grid.
      const col = Math.floor((x + (Math.floor(y / 5) % 2) * 3) / 6);
      const lx = (x + (Math.floor(y / 5) % 2) * 3) % 6;
      const ly = y % 5;
      const wall = lx === 0 || ly === 0;
      const lit = dx + dy < -8; // light from the top left
      const shade = d > 15 ? (lit ? 'e' : 'z') : lit ? 'n' : 'x';
      if (wall) row += d > 15 ? 'z' : 'k';
      else row += (col + Math.floor(y / 5)) % 4 === 0 && d < 15 ? 'm' : shade;
    }
    rows.push(row);
  }
  return rows;
}

export const HIVE: SpriteDef = { w: 40, h: 40, fps: 3, anchor: C, palette: P, frames: [hive(5), hive(6.5)] };
