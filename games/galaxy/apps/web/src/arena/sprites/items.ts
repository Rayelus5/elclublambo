import { P } from './palette';
import { grid, type SpriteDef } from './types';

// Loot, shots and ground decoration (DESIGN_SYSTEM §8 quater). The probe's shots are cold and bright; the enemies'
// bullets are Static red with a white heart, so they never look alike.

const C: [number, number] = [0.5, 0.5];
const still = (rows: string[]): SpriteDef => ({ w: rows[0]!.length, h: rows.length, fps: 0, anchor: C, palette: P, frames: [rows] });
const loop = (fps: number, ...frames: string[][]): SpriteDef => ({ w: frames[0]![0]!.length, h: frames[0]!.length, fps, anchor: C, palette: P, frames });

export const ITEMS: Record<string, SpriteDef> = {
  'xp-1': still(grid('..k..', '.kik.', 'kiwik', '.kbk.', '..k..')),
  'xp-5': still(grid('...k...', '..kgk..', '.kgwgk.', 'kgwggGk', '.kgGGk.', '..kGk..', '...k...')),
  'xp-25': still(grid('....k....', '...ksk...', '..kswsk..', '.kswsssk.', 'kswssssok', '.ksssook.', '..ksook..', '...kok...', '....k....')),
  coin: loop(
    6,
    grid('..kkk..', '.kssok.', 'kswsook', 'ksssook', 'ksssook', '.koook.', '..kkk..'),
    grid('..kkk..', '..ksk..', '.kswok.', '.kssok.', '.kssok.', '..kok..', '..kkk..'),
  ),
  dust: loop(4, grid('..i..', '..w..', 'iwwwi', '..w..', '..i..'), grid('.....', '..i..', '.iwi.', '..i..', '.....')),
  repair: still(grid('.kkkkkkk.', 'kgggggggk', 'kgggwgggk', 'kggwwwggk', 'kgwwwwwGk', 'kggwwwGGk', 'kgggwGGGk', 'kGGGGGGGk', '.kkkkkkk.')),

  bolt: still(grid('.kkk.', 'kwwsk', '.kkk.')),
  lance: still(grid('.kkkkkkkk.', 'kciiiiwwwk', '.kkkkkkkk.')),
  arc: loop(12, grid('..k...', '.kUk..', 'kUwUkk', '.kUwUk', '..kUk.', '...k..'), grid('...k..', '..kUk.', 'kkUwUk', 'kUwUk.', '.kUk..', '..k...')),
  'drone-bolt': still(grid('.k.', 'kik', '.k.')),
  orb: still(grid('..kkk..', '.kiiik.', 'kiwwiik', 'kiwiibk', 'kiiibbk', '.kbbbk.', '..kkk..')),
  drone: loop(
    8,
    grid('..kkkk..', '.kiwwik.', 'kkiccikk', 'kbkiikbk', 'kbkiikbk', 'kkiiiikk', '.kkiikk.', '...kk...'),
    grid('..kkkk..', '.kiwwik.', 'kkiccikk', 'kYkiikYk', 'kYkiikYk', 'kkiiiikk', '.kkiikk.', '...kk...'),
  ),
  blade: still(grid('...kk..', '..kwsk.', '.kwsk..', 'kwsk...', '.kwsk..', '..kwsk.', '...kk..')),
  'relic-ray': still(grid('.kkkkkkkkkk.', 'kUUUUUUwwwwk', '.kkkkkkkkkk.')),
  jet: still(grid('.kkkkkkkkkk.', 'kccccccwwwwk', '.kkkkkkkkkk.')),
  quasar: still(grid('..kkkkkkkkkk..', '.kssssssswwwk.', 'kssswwwwwwwwwk', '.kssssssswwwk.', '..kkkkkkkkkk..')),
  chaos: loop(10, grid('.kkk.', 'kcmck', 'kmwmk', 'kcmck', '.kkk.'), grid('.kkk.', 'kmcmk', 'kcwck', 'kmcmk', '.kkk.')),
  reflected: still(grid('.kkk.', 'kuwuk', 'kwwwk', 'kuwuk', '.kkk.')),
  'foe-bullet': loop(
    8,
    grid('..kkk..', '.kmmmk.', 'kmnwnmk', 'kmwwwmk', 'kmnwnmk', '.kmmmk.', '..kkk..'),
    grid('..kkk..', '.kmmmk.', 'kmnnnmk', 'kmnwnmk', 'kmnnnmk', '.kmmmk.', '..kkk..'),
  ),

  'rock-1': still(
    grid(
      '....kkkk....',
      '..kkTTTTkk..',
      '.kTTYTTTTTk.',
      'kTTYTTTTTttk',
      'kTTTTTtTtttk',
      'kTTTttttttk.',
      '.ktttttttk..',
      '..kkkkkkk...',
    ),
  ),
  'rock-2': still(grid('..kkk...', '.kTYTk..', 'kTYTTtk.', 'kTTTttkk', '.kTtttTk', '..kkkkk.')),
  'rock-3': still(
    grid(
      '.....kkkkk......',
      '...kkTTYTTkk....',
      '..kTTYYTTTTTkk..',
      '.kTTYTTTTTtTTTk.',
      'kTTTTTTTttttTttk',
      'kTTTtTTttttttttk',
      '.kTtttttttttttk.',
      '..kkttttttttkk..',
      '....kkkkkkkk....',
    ),
  ),
};
