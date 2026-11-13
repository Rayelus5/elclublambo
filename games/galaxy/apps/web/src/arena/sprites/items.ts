import { ELEMENT_GLYPH } from '../stage/palette';
import { P } from './palette';
import { grid, type SpriteDef } from './types';

// Loot, shots and ground decoration (DESIGN_SYSTEM §8 quater). The probe's shots are cold and bright; the enemies'
// bullets are Static red with a white heart, so they never look alike.

const C: [number, number] = [0.5, 0.5];
const still = (rows: string[]): SpriteDef => ({ w: rows[0]!.length, h: rows.length, fps: 0, anchor: C, palette: P, frames: [rows] });
const loop = (fps: number, ...frames: string[][]): SpriteDef => ({ w: frames[0]![0]!.length, h: frames[0]!.length, fps, anchor: C, palette: P, frames });

export const ITEMS: Record<string, SpriteDef> = {
  // Data fragments read as Terminal green at every size but the Solar 25 (SIM 1.7.0: the ice 1 looked like dust and
  // the cold grounds); the repair kit is a red cross, so nothing green on the ground but data.
  'xp-1': still(grid('..k..', '.kgk.', 'kgwgk', '.kGk.', '..k..')),
  'xp-5': still(grid('...k...', '..kgk..', '.kgwgk.', 'kgwggGk', '.kgGGk.', '..kGk..', '...k...')),
  'xp-25': still(grid('....k....', '...ksk...', '..kswsk..', '.kswsssk.', 'kswssssok', '.ksssook.', '..ksook..', '...kok...', '....k....')),
  coin: loop(
    6,
    grid('..kkk..', '.kssok.', 'kswsook', 'ksssook', 'ksssook', '.koook.', '..kkk..'),
    grid('..kkk..', '..ksk..', '.kswok.', '.kssok.', '.kssok.', '..kok..', '..kkk..'),
  ),
  dust: loop(4, grid('..i..', '..w..', 'iwwwi', '..w..', '..i..'), grid('.....', '..i..', '.iwi.', '..i..', '.....')),
  repair: still(grid('.kkkkkkk.', 'knnnnnnnk', 'knnnwnnnk', 'knnnwnnek', 'knwwwwwek', 'knnnwneek', 'knnnweeek', 'keeeeeeek', '.kkkkkkk.')),
  // A horseshoe magnet in the Static's red with white tips; the tips blink.
  magnet: loop(
    3,
    grid('..kkkkk..', '.kmmmmmk.', 'kmmkkkmmk', 'kmk...kmk', 'kmk...kmk', 'kYk...kYk', 'kwk...kwk', 'kkk...kkk'),
    grid('..kkkkk..', '.kmmmmmk.', 'kmmkkkmmk', 'kmk...kmk', 'kmk...kmk', 'kwk...kwk', 'kYk...kYk', 'kkk...kkk'),
  ),
  // A component: a steel nut with a Terminal core (the wallet's colour).
  component: still(grid('..k.k..', '.kTkTk.', 'kTYYYTk', '.kYgYk.', 'kTYYYTk', '.kTkTk.', '..k.k..')),
  // A signal for the deep scanner (SIM 1.10.0, from an abandoned satellite): a cyan diamond whose heart pulses.
  'signal-ticket': loop(
    4,
    grid('...k...', '..kck..', '.kcwck.', 'kcwwwck', '.kcwck.', '..kck..', '...k...'),
    grid('...k...', '..kck..', '.kcick.', 'kcicick', '.kcick.', '..kck..', '...k...'),
  ),
  // An abandoned satellite (SIM 1.10.0): flat like the probes, two blue solar panels on struts, a steel body with a dish,
  // its last status light still blinking.
  satellite: loop(
    2,
    grid(
      '.........kkk.........',
      '........kYwYk........',
      '.........kTk.........',
      'kkkkkkk.kkkkk.kkkkkkk',
      'kdDdDdkkkYYYkkkdDdDdk',
      'kDdDdDTTkYsYkTTDdDdDk',
      'kdDdDdkkkYYYkkkdDdDdk',
      'kkkkkkk.kTTTk.kkkkkkk',
      '.........kkk.........',
    ),
    grid(
      '.........kkk.........',
      '........kYwYk........',
      '.........kTk.........',
      'kkkkkkk.kkkkk.kkkkkkk',
      'kdDdDdkkkYYYkkkdDdDdk',
      'kDdDdDTTkYYYkTTDdDdDk',
      'kdDdDdkkkYYYkkkdDdDdk',
      'kkkkkkk.kTTTk.kkkkkkk',
      '.........kkk.........',
    ),
  ),

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
  // M3b-1: the arsenal's shots and the enemies' states.
  'missile': loop(
    12,
    grid('...kkkk..', 'okkTTTmk.', 'sokTYYmmk', 'okkTTTmk.', '...kkkk..'),
    grid('...kkkk..', 'skkTTTmk.', 'oskTYYmmk', 'skkTTTmk.', '...kkkk..'),
  ),
  'shard': still(grid('..k..', '.kck.', 'kciwk', '.kck.', '..k..')),
  'split-shard': still(grid('.k.', 'ksk', '.k.')),
  'mine': loop(
    4,
    grid('...kkk...', '..kTTTk..', '.kTYmYTk.', 'kTYmwmYTk', 'kTYYmYYTk', 'kTTYYYTTk', '.kTTTTTk.', '..kkkkk..', '.k.....k.'),
    grid('...kkk...', '..kTTTk..', '.kTYxYTk.', 'kTYxexYTk', 'kTYYxYYTk', 'kTTYYYTTk', '.kTTTTTk.', '..kkkkk..', '.k.....k.'),
  ),
  'disc': loop(
    16,
    grid('..kkkkk..', '.kccwcck.', 'kcikkkick', 'kckk.kkck', 'kck...kck', 'kckk.kkck', 'kcikkkick', '.kcciick.', '..kkkkk..'),
    grid('..kkkkk..', '.kcciick.', 'kcikkkick', 'kckk.kkck', 'kwk...kck', 'kckk.kkck', 'kcikkkick', '.kcciick.', '..kkkkk..'),
    grid('..kkkkk..', '.kcciick.', 'kcikkkick', 'kckk.kkck', 'kck...kck', 'kckk.kkck', 'kcikkkick', '.kccwcck.', '..kkkkk..'),
    grid('..kkkkk..', '.kcciick.', 'kcikkkick', 'kckk.kkck', 'kck...kwk', 'kckk.kkck', 'kcikkkick', '.kcciick.', '..kkkkk..'),
  ),
  'turret': loop(
    0,
    grid('..kkkkk....', '.kTTTTTk...', 'kTYYYYYTk..', 'kTYkkkYTkkk', 'kTYkcwkTTTk', 'kTYkkkYTkkk', 'kTYYYYYTk..', '.kTTTTTk...', '..kkkkk....'),
    grid('..kkkkk....', '.kTTTTTk...', 'kTYYYYYTk..', 'kTYkkkYTkks', 'kTYkcwkTTTw', 'kTYkkkYTkks', 'kTYYYYYTk..', '.kTTTTTk...', '..kkkkk....'),
  ),
  'strike-mark': loop(
    6,
    grid('....kmk....', '....kmk....', '...........', '..k.....k..', 'kk.......kk', 'mm...w...mm', 'kk.......kk', '..k.....k..', '...........', '....kmk....', '....kmk....'),
    grid('...........', '....kmk....', '....kmk....', '..k.....k..', '.kk.....kk.', '.mm..w..mm.', '.kk.....kk.', '..k.....k..', '....kmk....', '....kmk....', '...........'),
  ),
  'stun-star': loop(
    8,
    grid('..k..', '.ksk.', 'kswsk', '.ksk.', '..k..'),
    grid('.....', '..k..', '.kwk.', '..k..', '.....'),
  ),
  'mark-pip': still(grid('.w.', 'www', '.w.')),
  // Plan «escáner pro», part C: each element's mark has its own 3×3 shape, so it never relies on colour alone.
  ...Object.fromEntries(Object.entries(ELEMENT_GLYPH).map(([id, g]) => [`mark-${id}`, still(grid(...[0, 3, 6].map((k) => g.slice(k, k + 3).replace(/1/g, 'w').replace(/0/g, '.'))))])),
  // Nov plan B3: the magnetic harpoon's head (it turns with its line; the line itself is drawn) and the mortar's shell,
  // its fuse sparking (it is lobbed: the arena lifts it along its arc).
  harpoon: still(grid('...kk.....', '..kYTkkk..', 'kkkTYwwwwk', '..kYTkkk..', '...kk.....')),
  'mortar-shell': loop(
    10,
    grid('...w...', '..kok..', '.ktYTk.', 'ktYwTtk', 'koooook', 'kttTttk', '.kkkkk.'),
    grid('...s...', '..kok..', '.ktYTk.', 'ktYwTtk', 'koooook', 'kttTttk', '.kkkkk.'),
  ),
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
