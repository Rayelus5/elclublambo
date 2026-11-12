import { TRAITS } from '@galaxy/engine';
import { z } from 'zod';
import { DRAWN_FINISHES } from '../gacha/types';
import { FRAMES } from './missions';
import { ART_AVATARS } from '../cosmetics/catalog';

// The ECN Catalogue (GDD §12.3, §3; M7b): the album of galaxy types, palettes, phenomena and finishes an account has
// found, and the rewards for completing a share of it.

export const CATALOG_KINDS = ['galaxy_type', 'palette', 'phenomenon', 'finish'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

const valuesOf = (key: 'galaxy_type' | 'palette' | 'phenomenon') => TRAITS.traits[key].values.map((v) => v.value).filter((v) => v !== 'none');

/** Every entry of the album, in order (a phenomenon of «none» is not one). */
export function catalogEntries(): { kind: CatalogKind; value: string }[] {
  return [
    ...valuesOf('galaxy_type').map((value) => ({ kind: 'galaxy_type' as const, value })),
    ...valuesOf('palette').map((value) => ({ kind: 'palette' as const, value })),
    ...valuesOf('phenomenon').map((value) => ({ kind: 'phenomenon' as const, value })),
    // A season's exclusive finish stays out: whoever joins later can still complete the album (M8c).
    ...DRAWN_FINISHES.map((value) => ({ kind: 'finish' as const, value })),
  ];
}

const amount = z.number().int().min(0).max(10_000_000).default(0);
export const catalogRewardSchema = z
  .object({
    percent: z.number().int().min(1).max(100),
    reward: z.object({ coins: amount, dust: amount, signal: z.number().int().min(0).max(100).default(0), title: z.string().trim().min(1).max(30).nullable().default(null), frame: z.enum(FRAMES).nullable().default(null), avatar: z.enum(ART_AVATARS).nullable().default(null) }).strict(),
  })
  .strict();

export const DEFAULT_CATALOG_REWARDS = [
  { percent: 10, reward: { dust: 300 } },
  { percent: 25, reward: { signal: 2 } },
  { percent: 50, reward: { signal: 5, title: 'Cartógrafo', avatar: 'cartographer' as const } },
  { percent: 75, reward: { dust: 1500, title: 'Archivista', frame: 'aurora' as const } },
  { percent: 100, reward: { signal: 10, title: 'Guardián del cielo', frame: 'gold' as const } },
];

export interface CatalogView {
  entries: { kind: CatalogKind; value: string; found: boolean }[];
  found: number;
  total: number;
  /** Whole percent of the album found. */
  percent: number;
  rewards: { percent: number; reward: z.output<typeof catalogRewardSchema>['reward']; reached: boolean; claimed: boolean }[];
}

/** What the hub and the collection need to light the Catálogo's button: rewards reached and not collected yet. */
export interface CatalogSummary {
  ready: number;
  percent: number;
}

export const catalogClaimParamsSchema = z.object({ percent: z.coerce.number().int().min(1).max(100) }).strict();

/** The Códice's progress (GDD §15; M7b-2): what opens its entries, from runs that are not suspicious. */
export interface CodexProgress {
  /** Per sector played: the longest run (seconds) and the Cores purged there. */
  sectors: Record<string, { maxSeconds: number; bossKills: number }>;
  bossKills: number;
  maxDepth: number;
  level: number;
}

/** The first steps (GDD §12.2; M7c): each one is done or not, in order. */
export const ONBOARDING_STEPS = ['probeTest', 'firstRun', 'welcomePulls', 'repairRoom', 'equipRelic'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type OnboardingView = Record<OnboardingStep, boolean>;
