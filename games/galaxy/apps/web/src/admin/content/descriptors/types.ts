import type { FieldInfo } from '../../forms/labels';

// The content editor's descriptors (2026-11-16, P4): what every field of the run content is called and means in plain
// Spanish, for admins who never read the game's code. A field is named by its pattern in the content («enemies[].hp»,
// «sectors[].spawns[].group», «elements.palettes.*»); a field of one variant may have its own description
// («enemies[].behavior<shooter>.range») and falls back to the plain one. The values of a choice (a weapon's kind, an
// enemy's behaviour, an element) come from a vocabulary: each value with its name and what it does.

/** The sets of values the content chooses from, each described once. */
export type VocabName =
  | 'element'
  | 'weaponKind'
  | 'special'
  | 'stat'
  | 'quirk'
  | 'behavior'
  | 'bossPattern'
  | 'enemyFamily'
  | 'eliteId'
  | 'supportEffect'
  | 'biome'
  | 'waveKind'
  | 'reactionEffect'
  | 'phenomenon'
  | 'setKind'
  | 'sameTrait'
  | 'eventKind'
  /** A weapon variant's level (4 or 8). */
  | 'unlockLevel'
  /** How many relics a set's tier asks for (2 or 3). */
  | 'setCount';

/** One value of a vocabulary: its name, and what it does in a sentence or two (no final period). */
export interface Term {
  label: string;
  explain: string;
}
export type Vocab = Record<string, Term>;

/**
 * A field: its name (short, no final period, none of the symbols · : — →) and a hint that says what it changes in the
 * game in plain words (no final period, never a number an admin can change). `vocab` names the values of a choice;
 * `section` groups the fields of a card; `advanced` hides it behind «Más ajustes».
 */
export interface FieldDesc extends Omit<FieldInfo, 'hint' | 'options'> {
  label: string;
  hint: string;
  vocab?: VocabName;
  /** Where its choices come from when they are other entities («enemies», «bosses», «weapons», «passives»…). */
  options?: string;
  section?: string;
  advanced?: boolean;
}
export type FieldTable = Record<string, FieldDesc>;

/** What one descriptor file gives: its fields and the vocabularies it owns. */
export interface DescriptorPart {
  fields: FieldTable;
  vocabs?: Partial<Record<VocabName, Vocab>>;
}
