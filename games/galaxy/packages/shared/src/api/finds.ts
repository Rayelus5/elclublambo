import { galaxyOfSeed } from '../gacha/generate';
import { LEGENDARY, MYTHIC, TIERS } from '../gacha/types';
import type { PulledGalaxy } from './economy';

// What the scanner shows of what is found (2026-11-17, the owner: «Escaparate de premios» and «Últimos hallazgos»): the
// legendaries and mythics found lately by anyone (who, when, in which scanner), my own best scans of the week, the
// showcase of what can come out (real finds, topped up with fixed examples) and each event scanner's featured galaxy.

/** A galaxy shown as an example (never pulled): its id is `example-<seed>`. */
export type ShownGalaxy = PulledGalaxy & { example?: true };

export interface FindView {
  /** The pull's id. */
  id: string;
  /** Who found it (an active, visible account). */
  by: string;
  /** When (ISO). */
  at: string;
  /** The scanner it came from. */
  banner: string;
  galaxy: PulledGalaxy;
}

export interface FindsView {
  /** Legendaries and mythics found lately, newest first. */
  recent: FindView[];
  /** My best scans of the last days (epic and up), best first. */
  mine: PulledGalaxy[];
  /** What can come out: real finds first, then examples. */
  showcase: ShownGalaxy[];
  /** Each open event scanner's featured galaxy: the last one found, or an example. */
  featured: Record<string, ShownGalaxy>;
}

/** The showcase's examples (2026-11-17): known galaxy seeds, four legendaries and two mythics (shown only when mythics can come out). */
export const SHOWCASE_SEEDS: readonly { seed: string; tier: number }[] = [
  { seed: '9297137456147662981', tier: LEGENDARY },
  { seed: '5311704517889220177', tier: LEGENDARY },
  { seed: '17453394667225957625', tier: LEGENDARY },
  { seed: '944367713692463849', tier: LEGENDARY },
  { seed: '1472268781806732093', tier: MYTHIC },
  { seed: '16555340779960930048', tier: MYTHIC },
];

/** An example galaxy as the showcase shows it (a normal finish: it is not a promise of one). */
export function showcaseExample(s: { seed: string; tier: number }): ShownGalaxy {
  const g = galaxyOfSeed(BigInt(s.seed));
  return {
    id: `example-${s.seed}`,
    seed: s.seed,
    tier: TIERS[s.tier]!,
    finish: 'normal',
    traits: g.traits as unknown as Record<string, string>,
    name: g.name,
    designation: g.designation,
    featured: false,
    example: true,
  };
}
