import type { ChordExt, Mode } from './theory';

// The soundtrack's compositions (plan «banda sonora», part A; the owner: «una banda sonora completa… con variedad
// suficiente para que no se sienta repetitivo, muy chill y original… en las incursiones más épicas»). Each one is data
// with no instruments: its key and mode, its tempo, its sections as chord progressions, the forms it can take from one
// loop to the next, and its motif (a two-bar phrase in scale degrees). A style (styles.ts) plays it with its own
// instruments, rhythm and effects, so 13 compositions make 39 versions. Ids are also the file names that can replace a
// piece (assets/audio/musica/LEEME.md), so they never change.

export type Group = 'menu' | 'sector' | 'boss' | 'results';
export type Biome = 'nebula' | 'ice' | 'reef' | 'forge' | 'rift';
export type Texture = 'wind' | 'crystal' | 'bubbles' | 'embers' | 'static' | 'space';

export interface ChordStep {
  degree: number;
  ext: ChordExt;
  bars: 1 | 2;
}

export interface Motif {
  /** Scale degrees from the tonic (null: a rest), one per entry of `steps`. */
  notes: (number | null)[];
  /** Each note's length in sixteenths; together, 32 (two bars). */
  steps: number[];
}

export interface Composition {
  id: string;
  group: Group;
  /** Shown in the music Ensayo. */
  name: string;
  biome?: Biome;
  deep?: boolean;
  /** The key's tonic as a MIDI note (around the bass's register) and its mode. */
  tonic: number;
  mode: Mode;
  bpm: number;
  sections: Record<string, ChordStep[]>;
  /** The first form is the first loop's; later loops pick one by their seed. */
  forms: string[][];
  motif: Motif;
  /** Its colour: brightness (0 dark … 1 bright), shimmer of the high bells, the bed's texture, and drive (energy). */
  color: { bright: number; shimmer: number; texture: Texture; drive: number };
}

const c = (degree: number, ext: ChordExt = 'triad', bars: 1 | 2 = 2): ChordStep => ({ degree, ext, bars });
const m = (notes: (number | null)[], steps: number[]): Motif => ({ notes, steps });

export const COMPOSITIONS: readonly Composition[] = [
  // ---- The home menu: four pieces in a playlist, calm and wide.
  {
    id: 'menu-deriva',
    group: 'menu',
    name: 'Deriva',
    tonic: 50, // D
    mode: 'lydian',
    bpm: 70,
    sections: {
      A: [c(0, '7'), c(1), c(5, '7'), c(0, 'add9')],
      B: [c(2, '7'), c(5, '7'), c(4, 'sus2'), c(0, 'add9')],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
      ['B', 'A', 'A', 'B'],
    ],
    motif: m([4, null, 3, 4, 7, null, 6, 4, null], [4, 2, 2, 4, 6, 2, 4, 6, 2]),
    color: { bright: 0.55, shimmer: 0.7, texture: 'space', drive: 0.2 },
  },
  {
    id: 'menu-faro',
    group: 'menu',
    name: 'Faro',
    tonic: 54, // F#
    mode: 'dorian',
    bpm: 66,
    sections: {
      A: [c(0, '9'), c(3, '7'), c(0, '9'), c(6, 'add9')],
      B: [c(2, '7'), c(6), c(3, '7'), c(4, 'sus4', 1), c(4, 'triad', 1)],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'B', 'A'],
    ],
    motif: m([2, 4, null, 5, 4, 2, null, 1, 0], [2, 4, 2, 4, 4, 6, 2, 4, 4]),
    color: { bright: 0.45, shimmer: 0.5, texture: 'wind', drive: 0.15 },
  },
  {
    id: 'menu-marea',
    group: 'menu',
    name: 'Marea',
    tonic: 51, // E flat
    mode: 'ionian',
    bpm: 74,
    sections: {
      A: [c(0, 'add9'), c(2, '7'), c(5, '7'), c(3, '7')],
      B: [c(1, '7'), c(4, 'sus4', 1), c(4, 'triad', 1), c(0, 'add9'), c(5, '7')],
    },
    forms: [
      ['A', 'B', 'A', 'B'],
      ['A', 'A', 'B', 'B'],
    ],
    motif: m([0, 2, 4, null, 6, 5, 4, null, 2], [2, 2, 4, 4, 6, 2, 6, 2, 4]),
    color: { bright: 0.6, shimmer: 0.6, texture: 'space', drive: 0.25 },
  },
  {
    id: 'menu-polvo',
    group: 'menu',
    name: 'Polvo de estrellas',
    tonic: 45, // A
    mode: 'mixolydian',
    bpm: 72,
    sections: {
      A: [c(0, 'add9'), c(6), c(3, 'add9'), c(0)],
      B: [c(5, '7'), c(3), c(4, '7'), c(0, 'sus2')],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['B', 'A', 'B', 'A'],
    ],
    motif: m([7, null, 6, 4, 2, null, 4, 3, 2], [3, 1, 4, 4, 6, 2, 4, 4, 4]),
    color: { bright: 0.5, shimmer: 0.8, texture: 'space', drive: 0.2 },
  },

  // ---- The sectors: one per biome, each with its own colour; their layers follow the run (calm → combat → danger).
  {
    id: 'sector-nebulosa',
    group: 'sector',
    name: 'Nebulosa exterior',
    biome: 'nebula',
    tonic: 52, // E
    mode: 'dorian',
    bpm: 94,
    sections: {
      A: [c(0), c(3), c(0, '7'), c(6)],
      B: [c(2), c(6), c(0), c(4, '7')],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
      ['B', 'B', 'A', 'A'],
    ],
    motif: m([0, 2, 4, 3, 2, null, 4, 5, 4], [2, 2, 4, 2, 6, 2, 4, 4, 6]),
    color: { bright: 0.55, shimmer: 0.4, texture: 'space', drive: 0.55 },
  },
  {
    id: 'sector-hielo',
    group: 'sector',
    name: 'Anillos de escarcha',
    biome: 'ice',
    tonic: 49, // C sharp
    mode: 'aeolian',
    bpm: 88,
    sections: {
      A: [c(0, 'add9'), c(5, '7'), c(2, 'add9'), c(6)],
      B: [c(3, '7'), c(5), c(6, 'sus2'), c(0)],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
    ],
    motif: m([7, 4, null, 6, 7, 9, null, 7, 4], [2, 4, 2, 4, 4, 6, 2, 4, 4]),
    color: { bright: 0.8, shimmer: 1, texture: 'crystal', drive: 0.45 },
  },
  {
    id: 'sector-arrecife',
    group: 'sector',
    name: 'Arrecife hueco',
    biome: 'reef',
    tonic: 43, // G
    mode: 'mixolydian',
    bpm: 100,
    sections: {
      A: [c(0), c(6), c(3), c(0)],
      B: [c(4, '7'), c(3), c(1, '7'), c(0, 'sus4', 1), c(0, 'triad', 1)],
    },
    forms: [
      ['A', 'B', 'A', 'B'],
      ['A', 'A', 'B', 'B'],
    ],
    motif: m([4, 5, 4, 2, null, 0, 2, 4, null, 6], [2, 2, 2, 4, 2, 4, 4, 6, 2, 4]),
    color: { bright: 0.6, shimmer: 0.5, texture: 'bubbles', drive: 0.6 },
  },
  {
    id: 'sector-forja',
    group: 'sector',
    name: 'Forja rota',
    biome: 'forge',
    tonic: 50, // D
    mode: 'phrygian',
    bpm: 104,
    sections: {
      A: [c(0), c(1), c(0), c(6)],
      B: [c(3), c(5), c(1), c(0, 'sus4', 1), c(0, 'triad', 1)],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
    ],
    motif: m([0, 1, 0, null, 4, 3, 1, null, 0], [2, 2, 4, 2, 6, 2, 4, 2, 8]),
    color: { bright: 0.4, shimmer: 0.2, texture: 'embers', drive: 0.75 },
  },
  {
    id: 'sector-fisura',
    group: 'sector',
    name: 'Fisura de la señal',
    biome: 'rift',
    tonic: 46, // B flat
    mode: 'harmonic',
    bpm: 108,
    sections: {
      A: [c(0), c(5), c(3), c(4)],
      B: [c(0, 'triad', 1), c(5, 'triad', 1), c(3, 'triad', 1), c(4, 'triad', 1), c(5), c(4, '7')],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'B', 'A'],
    ],
    motif: m([0, 2, 4, 6, 7, null, 6, 4, 2], [2, 2, 2, 2, 6, 2, 4, 4, 8]),
    color: { bright: 0.5, shimmer: 0.3, texture: 'static', drive: 0.8 },
  },

  // ---- The Núcleos: epic, in minor, entering on the bar.
  {
    id: 'nucleo-1',
    group: 'boss',
    name: 'Núcleo',
    tonic: 45, // A
    mode: 'harmonic',
    bpm: 118,
    sections: {
      A: [c(0), c(5), c(3), c(4)],
      B: [c(0, 'triad', 1), c(3, 'triad', 1), c(5, 'triad', 1), c(4, 'triad', 1), c(0, 'triad', 1), c(3, 'triad', 1), c(4, '7')],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
    ],
    motif: m([0, null, 0, 2, 4, 5, 4, 3, 2], [3, 1, 2, 2, 4, 4, 4, 4, 8]),
    color: { bright: 0.55, shimmer: 0.2, texture: 'space', drive: 0.95 },
  },
  {
    id: 'nucleo-2',
    group: 'boss',
    name: 'Núcleo, segunda forma',
    tonic: 41, // F
    mode: 'aeolian',
    bpm: 112,
    sections: {
      A: [c(0), c(3), c(6), c(2)],
      B: [c(5), c(6), c(4, '7'), c(0)],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
    ],
    motif: m([4, 3, 2, null, 4, 5, 7, 6, 4], [2, 2, 4, 2, 2, 4, 6, 2, 8]),
    color: { bright: 0.5, shimmer: 0.25, texture: 'space', drive: 0.9 },
  },
  {
    id: 'nucleo-profundo',
    group: 'boss',
    name: 'Núcleo profundo',
    deep: true,
    tonic: 48, // C
    mode: 'phrygian',
    bpm: 100,
    sections: {
      A: [c(0), c(1), c(0), c(6)],
      B: [c(5), c(1), c(3), c(0)],
    },
    forms: [
      ['A', 'A', 'B', 'A'],
      ['A', 'B', 'A', 'B'],
    ],
    motif: m([0, 1, null, 0, -1, 0, null, 4, 3], [4, 4, 2, 2, 4, 4, 2, 4, 6]),
    color: { bright: 0.35, shimmer: 0.15, texture: 'static', drive: 1 },
  },

  // ---- The results: quiet, after a run.
  {
    id: 'resultados',
    group: 'results',
    name: 'Resultados',
    tonic: 43, // G
    mode: 'ionian',
    bpm: 64,
    sections: {
      A: [c(0, 'add9'), c(4, 'sus4'), c(5, '7'), c(3, '7')],
    },
    forms: [['A', 'A']],
    motif: m([4, null, 2, 4, 5, null, 4, 2], [4, 2, 2, 8, 6, 2, 4, 4]),
    color: { bright: 0.5, shimmer: 0.6, texture: 'space', drive: 0.1 },
  },
];

export const compositionById = (id: string): Composition | undefined => COMPOSITIONS.find((x) => x.id === id);

/** How many bars a form lasts. */
export const formBars = (comp: Composition, form: readonly string[]): number => form.reduce((sum, s) => sum + (comp.sections[s] ?? []).reduce((n, ch) => n + ch.bars, 0), 0);
