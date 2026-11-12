import type { Group } from './compositions';

// The soundtrack's styles (plan «banda sonora», part A; the owner chose three, picked in Ajustes, «Ambiente espacial»
// by default). A style plays any composition its own way: which instruments take each role, in which layer of
// intensity they join (0 always … 3 danger), their rhythms as 16-step patterns, their registers, the mix and the
// effects. Patterns: `x` a hit, `o` a soft one, `.` a rest; for the bass `0` root, `3` third, `5` fifth, `8` octave;
// for the arpeggio a digit is a chord tone, low to high.

export const MUSIC_STYLES = ['ambient'] as const;
export type MusicStyleId = (typeof MUSIC_STYLES)[number];

export type Role = 'pad' | 'bass' | 'arp' | 'keys' | 'lead' | 'bells' | 'choir' | 'brass' | 'timpani' | 'kick' | 'snare' | 'hat' | 'shaker' | 'tom' | 'texture';
export type Layer = 0 | 1 | 2 | 3;

/** The synthesized instruments (voices.ts). */
export type VoiceName = 'pad' | 'sub' | 'pluck' | 'bells' | 'flute' | 'choir' | 'brass' | 'timpani' | 'kick' | 'snare' | 'hat' | 'tom' | 'texture';

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

export const STYLES: Record<MusicStyleId, Style> = { ambient: AMBIENT };
