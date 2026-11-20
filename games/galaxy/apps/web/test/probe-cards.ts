import { parseConfig, probeLevelBonuses, probeLevelNext, probeMaxLevel, type ProbeCard, probeVariantCards } from '@galaxy/shared';
import { DEFAULT_CONTENT, type ProbeDef } from '@galaxy/sim';

// The level fields of a probe card (M4b-1) for test fixtures: level 1 by default, its base weapon, its variant cards.
const cfg = parseConfig('probes', {});

export function levelOne(p: ProbeDef, level = 1, variant: string | null = null): Pick<ProbeCard, 'level' | 'maxLevel' | 'next' | 'bonuses' | 'variant' | 'variants' | 'skin' | 'skins' | 'runs'> {
  return {
    level,
    maxLevel: probeMaxLevel(cfg),
    next: probeLevelNext(level, cfg),
    bonuses: probeLevelBonuses(level, cfg),
    variant: variant ?? p.weapon,
    variants: probeVariantCards(p, level, DEFAULT_CONTENT),
    skin: null,
    skins: [],
    runs: 0,
  };
}
