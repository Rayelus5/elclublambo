import type { Group, Texture } from './compositions';

// The soundtrack's styles (plan «banda sonora», part A; the owner chose three, picked in Ajustes, «Ambiente espacial»
// by default). A style plays any composition its own way: which instruments take each role, in which layer of
// intensity they join (0 always … 3 danger), their rhythms as 16-step patterns, their registers, the mix and the
// effects. Patterns: `x` a hit, `o` a soft one, `.` a rest; for the bass `0` root, `3` third, `5` fifth, `8` octave;
// for the arpeggio a digit is a chord tone, low to high.

export const MUSIC_STYLES = ['ambient', 'lofi', 'synthwave'] as const;
export type MusicStyleId = (typeof MUSIC_STYLES)[number];

export type Role = 'pad' | 'bass' | 'arp' | 'keys' | 'lead' | 'bells' | 'choir' | 'brass' | 'timpani' | 'kick' | 'snare' | 'hat' | 'shaker' | 'tom' | 'texture';
export type Layer = 0 | 1 | 2 | 3;

/** The synthesized instruments (voices.ts). */
export type VoiceName =
  | 'pad'
  | 'sub'
  | 'pluck'
  | 'bells'
  | 'flute'
  | 'choir'
  | 'brass'
  | 'timpani'
  | 'kick'
  | 'snare'
  | 'hat'
  | 'tom'
  | 'texture'
  | 'epiano'
  | 'lofikick'
  | 'lofisnare'
  | 'lofihat'
  | 'sawpad'
  | 'pulsebass'
  | 'arpsaw'
  | 'sawlead'
  | 'synthkick'
  | 'gatesnare';

export interface Style {
  id: MusicStyleId;
  /** Its tempo against the composition's. */
  tempo: number;
  /** How late the off-beat sixteenths come (0 straight … 0.33 a heavy swing), as a share of a sixteenth. */
  swing: number;
  /** Each role's layer, by group (a role missing from a group does not play there). */
  arrangement: Record<Group, Partial<Record<Role, Layer>>>;
  voices: Record<Role, VoiceName>;
  /** Each role's level. */
  mix: Record<Role, number>;
  /** Where each melodic role sits (a MIDI note it stays near). */
  center: { pad: number; lead: number; bells: number; arp: number; keys: number; choir: number; brass: number };
  bass: { calm: string; drive: string };
  arp: { pattern: string; chance: number };
  keys: string;
  /** Drums by group: the layer-2 groove and the layer-3 extras (toms, shakers). */
  drums: Record<'sector' | 'boss' | 'menu', { kick: string; snare: string; hat: string; shaker: string; tom: string }>;
  boss: { timpani: string; brass: string };
  fx: { reverb: number; wet: number; delayBeats: number; feedback: number; tone: number };
  /** Its own bed texture, over each piece's (the lo-fi's record). */
  texture?: Texture;
}

const AMBIENT: Style = {
  id: 'ambient',
  tempo: 1,
  swing: 0,
  arrangement: {
    menu: { pad: 0, texture: 0, bass: 0, bells: 1, arp: 1, lead: 2, shaker: 2 },
    sector: { pad: 0, texture: 0, bass: 1, arp: 1, bells: 1, kick: 2, snare: 2, hat: 2, lead: 2, tom: 3, shaker: 3, choir: 3 },
    boss: { pad: 0, texture: 0, bass: 0, timpani: 1, kick: 1, arp: 2, hat: 2, snare: 2, choir: 2, brass: 3, lead: 3, tom: 3, shaker: 3 },
    results: { pad: 0, texture: 0, bass: 0, bells: 0, arp: 1 },
  },
  voices: {
    pad: 'pad',
    bass: 'sub',
    arp: 'pluck',
    keys: 'pluck',
    lead: 'flute',
    bells: 'bells',
    choir: 'choir',
    brass: 'brass',
    timpani: 'timpani',
    kick: 'kick',
    snare: 'snare',
    hat: 'hat',
    shaker: 'hat',
    tom: 'tom',
    texture: 'texture',
  },
  mix: { pad: 0.3, bass: 0.2, arp: 0.3, keys: 0.25, lead: 0.36, bells: 0.36, choir: 0.24, brass: 0.22, timpani: 0.3, kick: 0.32, snare: 0.3, hat: 0.16, shaker: 0.12, tom: 0.26, texture: 0.3 },
  center: { pad: 60, lead: 74, bells: 81, arp: 69, keys: 64, choir: 64, brass: 57 },
  bass: { calm: '0.......5.......', drive: '0.0.0.0.0.0.5.8.' },
  arp: { pattern: '0.1.2.3.2.1.4.2.', chance: 0.8 },
  keys: 'x...o...x...o...',
  drums: {
    menu: { kick: '................', snare: '................', hat: '................', shaker: '..o...o...o...o.', tom: '................' },
    sector: { kick: 'x.......x.......', snare: '........o.......', hat: '..o...o...o...o.', shaker: 'o.o.o.o.o.o.o.oo', tom: 'x.......x.x.....' },
    boss: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.', shaker: 'oooooooooooooooo', tom: 'x..x..x...x..x..' },
  },
  boss: { timpani: 'x.....x.x.......', brass: 'x.......x..x....' },
  fx: { reverb: 3.6, wet: 0.42, delayBeats: 0.75, feedback: 0.32, tone: 7200 },
};

// Lo-fi espacial: slower, swung, an electric piano comping the chords over a soft kit and the record's crackle; the
// melody on a mellow flute, the bells now and then.
const LOFI: Style = {
  id: 'lofi',
  tempo: 0.82,
  swing: 0.18,
  arrangement: {
    menu: { keys: 0, bass: 0, texture: 0, kick: 1, snare: 1, hat: 1, lead: 2, bells: 2 },
    sector: { keys: 0, texture: 0, bass: 1, kick: 1, snare: 1, hat: 1, arp: 2, lead: 2, shaker: 3, tom: 3, choir: 3 },
    boss: { keys: 0, bass: 0, texture: 0, kick: 1, snare: 1, hat: 2, choir: 2, timpani: 2, brass: 2, lead: 3, shaker: 3, tom: 3 },
    results: { keys: 0, bass: 0, texture: 0, bells: 1 },
  },
  voices: {
    pad: 'pad',
    bass: 'sub',
    arp: 'epiano',
    keys: 'epiano',
    lead: 'flute',
    bells: 'bells',
    choir: 'choir',
    brass: 'brass',
    timpani: 'timpani',
    kick: 'lofikick',
    snare: 'lofisnare',
    hat: 'lofihat',
    shaker: 'lofihat',
    tom: 'tom',
    texture: 'texture',
  },
  mix: { pad: 0.25, bass: 0.17, arp: 0.24, keys: 0.44, lead: 0.34, bells: 0.3, choir: 0.2, brass: 0.18, timpani: 0.24, kick: 0.3, snare: 0.4, hat: 0.32, shaker: 0.2, tom: 0.22, texture: 0.35 },
  center: { pad: 60, lead: 72, bells: 79, arp: 67, keys: 62, choir: 64, brass: 57 },
  bass: { calm: '0.......5..0....', drive: '0..0..5.0..0.8..' },
  arp: { pattern: '0..1..2...3..2..', chance: 0.7 },
  keys: 'x.....o...x..o..',
  drums: {
    menu: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.', shaker: '................', tom: '................' },
    sector: { kick: 'x......x..x.....', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.oo', shaker: '..o...o...o...o.', tom: '..........x.x...' },
    boss: { kick: 'x..x...xx.x.....', snare: '....x.......x...', hat: 'oooooooooooooooo', shaker: 'o.o.o.o.o.o.o.o.', tom: 'x..x..x...x..x..' },
  },
  boss: { timpani: 'x.......x.......', brass: 'x.......x.......' },
  fx: { reverb: 2.2, wet: 0.26, delayBeats: 0.75, feedback: 0.24, tone: 4200 },
  texture: 'vinyl',
};

// Synthwave suave: wide saw pads, a pulsing eighth-note bass, a steady arpeggio, a gated snare; easy on the menu
// (no drums but a hat), the full drive in a sector, and epic in a Núcleo.
const SYNTHWAVE: Style = {
  id: 'synthwave',
  tempo: 1.05,
  swing: 0,
  arrangement: {
    menu: { pad: 0, bass: 0, texture: 0, arp: 1, lead: 2, hat: 2 },
    sector: { pad: 0, texture: 0, bass: 1, arp: 1, kick: 2, snare: 2, hat: 2, lead: 2, tom: 3, shaker: 3, brass: 3 },
    boss: { pad: 0, bass: 0, arp: 1, kick: 1, snare: 2, hat: 2, brass: 2, choir: 2, timpani: 2, lead: 3, tom: 3, shaker: 3 },
    results: { pad: 0, bass: 0, arp: 1, texture: 0 },
  },
  voices: {
    pad: 'sawpad',
    bass: 'pulsebass',
    arp: 'arpsaw',
    keys: 'sawpad',
    lead: 'sawlead',
    bells: 'bells',
    choir: 'choir',
    brass: 'brass',
    timpani: 'tom',
    kick: 'synthkick',
    snare: 'gatesnare',
    hat: 'hat',
    shaker: 'hat',
    tom: 'tom',
    texture: 'texture',
  },
  mix: { pad: 0.44, bass: 0.28, arp: 0.32, keys: 0.25, lead: 0.32, bells: 0.26, choir: 0.22, brass: 0.22, timpani: 0.3, kick: 0.36, snare: 0.32, hat: 0.16, shaker: 0.1, tom: 0.26, texture: 0.22 },
  center: { pad: 60, lead: 76, bells: 81, arp: 69, keys: 64, choir: 64, brass: 57 },
  bass: { calm: '0...0...0...0...', drive: '0.0.0.0.0.0.0.0.' },
  arp: { pattern: '0.1.2.3.0.1.2.3.', chance: 1 },
  keys: 'x.......x.......',
  drums: {
    menu: { kick: '................', snare: '................', hat: '..o...o...o...o.', shaker: '................', tom: '................' },
    sector: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', shaker: 'o.o.o.o.o.o.o.o.', tom: '..........xx.x..' },
    boss: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'o.o.o.o.o.o.o.o.', shaker: 'oooooooooooooooo', tom: 'x.x...x.x.x.x...' },
  },
  boss: { timpani: 'x.......x.x.....', brass: 'x.......x..x....' },
  fx: { reverb: 2.8, wet: 0.3, delayBeats: 0.75, feedback: 0.38, tone: 6500 },
};

export const STYLES: Record<MusicStyleId, Style> = { ambient: AMBIENT, lofi: LOFI, synthwave: SYNTHWAVE };
