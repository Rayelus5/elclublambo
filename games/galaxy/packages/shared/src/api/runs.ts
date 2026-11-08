import type { NextSlot } from '../relics/progress';
import type { Content, Quirk, RelicInput, StatBonus } from '@galaxy/sim';
import { z } from 'zod';
import type { GalaxySummary } from './economy';
import type { ProbeCondition } from '../probes/unlocks';
import type { SectorCondition } from '../sectors/unlocks';
import type { Wallet } from '../gacha/types';

// Requests and responses of the hangar and the runs (GDD §5.1, §11.3 bis, §14.7). Mutating calls carry an
// `Idempotency-Key`; a run's result is sent once, with its recorded inputs.

const contentId = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const loadoutRequestSchema = z
  .object({ relics: z.array(z.uuid().nullable()).max(6) })
  .strict()
  .refine((r) => {
    const ids = r.relics.filter((x): x is string => x !== null);
    return new Set(ids).size === ids.length;
  }, 'duplicate_ids');
export type LoadoutRequest = z.infer<typeof loadoutRequestSchema>;

/** The probe test (GDD §6): five answers, plus the tiebreak when the five tie. */
export const probeTestRequestSchema = z.object({ answers: z.array(z.number().int().min(0).max(2)).min(5).max(6) }).strict();
export type ProbeTestRequest = z.infer<typeof probeTestRequestSchema>;
export interface ProbeTestResult {
  probe: string;
}

/** The probe for the next run (one the account has unlocked). */
export const probeChoiceSchema = z.object({ probe: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();
export type ProbeChoice = z.infer<typeof probeChoiceSchema>;

export const sectorChoiceSchema = z.object({ sector: z.string().regex(/^[a-z0-9-]{1,32}$/) }).strict();
export type SectorChoice = z.infer<typeof sectorChoiceSchema>;

export const startRunRequestSchema = z.object({ sector: contentId, probe: contentId, simVersion: z.string().min(1).max(20) }).strict();
export type StartRunRequest = z.infer<typeof startRunRequestSchema>;

const count = (max: number) => z.number().int().min(0).max(max);

export const finishRunRequestSchema = z
  .object({
    outcome: z.enum(['extracted', 'died', 'abandoned']),
    /** World ticks played (60 per second); at most 6 hours. */
    ticks: count(1_296_000),
    depth: z.number().int().min(1).max(999),
    kills: count(10_000_000),
    bossKills: count(999),
    level: z.number().int().min(1).max(999),
    /** Coins and star dust picked up in each layer (length = depth). */
    loot: z.array(z.object({ coins: count(10_000_000), dust: count(10_000_000) }).strict()).min(1).max(999),
    /** The simulation's final state hash. */
    hash: z.string().regex(/^[0-9a-f]{16}$/),
    /** The recorded inputs (packages/sim encodeLog) in base64. */
    inputs: z.string().max(2_800_000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict()
  .refine((r) => r.loot.length === r.depth, 'loot_depth');
export type FinishRunRequest = z.infer<typeof finishRunRequestSchema>;
/** A finished run as the rules see it (everything but the inputs). */
export type RunClaim = Omit<FinishRunRequest, 'inputs'>;

export interface SectorCard {
  id: string;
  name: string;
  description: string;
  boss: { name: string; title: string; sprite: string };
  fauna: { id: string; name: string; sprite: string }[];
  layerSeconds: number;
  biome: string;
  unlocked: boolean;
  /** What opens it (null: open from the start, or a season sector). The client names the condition's Core. */
  condition: SectorCondition | null;
  /** 0–1 towards the condition. */
  progress: number;
  /** A season sector (GDD §13.1): open only while its season lasts. */
  season: boolean;
}

export interface ProbeCard {
  id: string;
  name: string;
  description: string;
  sprite: string;
  hp: number;
  speed: number;
  weapon: { id: string; name: string; icon: string };
  /** Its quirk's kind (what it does is told by the client's copy). */
  quirk: Quirk['kind'] | null;
  unlocked: boolean;
  /** What earns it (null: the test's probe, or one that cannot be earned yet). */
  condition: ProbeCondition | null;
  /** 0–1 towards the condition. */
  progress: number;
  /** Its level (GDD §6, M4b-1), 1–maxLevel, and what reaching the next costs (null at the top). */
  level: number;
  maxLevel: number;
  next: { components: number; coins: number } | null;
  /** What its level adds to its stats. */
  bonuses: StatBonus[];
  /** The weapon it would start with: its base or the chosen variant (if its level still opens it). */
  variant: string;
  /** The base weapon first, then its variants. */
  variants: ProbeVariantCard[];
}

/** One starting weapon in the Hangar's picker. */
export interface ProbeVariantCard {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** The probe level that opens it (1 for the base). */
  unlockAt: number;
  unlocked: boolean;
  element: string | null;
}

/** A probe's next level, named so a stale view never buys the one after (M4b-1). */
export const probeLevelUpSchema = z.object({ level: z.number().int().min(2).max(20) }).strict();
export type ProbeLevelUp = z.infer<typeof probeLevelUpSchema>;
/** The starting weapon: the base or one of its variants. */
export const probeVariantSchema = z.object({ variant: contentId }).strict();
export type ProbeVariantChoice = z.infer<typeof probeVariantSchema>;

export interface DailyView {
  playedSeconds: number;
  /** Seconds of play left today at the full rate. */
  fullSecondsLeft: number;
  /** The rate the next minute would pay. */
  multiplier: number;
  /** When the day restarts (Madrid midnight), ISO. */
  resetsAt: string;
}

export interface HangarView {
  sectors: SectorCard[];
  /** The sector for the next run: the one chosen, or the Nebulosa if it is no longer open. */
  sector: string;
  probes: ProbeCard[];
  probe: string;
  /** The probe test: taken or not, and the probe it gave. */
  test: { taken: boolean; probe: string | null };
  slots: number;
  maxSlots: 6;
  /** One entry per open slot. */
  loadout: (GalaxySummary | null)[];
  daily: DailyView;
  runsEnabled: boolean;
  /** The next relic slot to open (M4c-1): its milestone, progress and dust; null when all six are open. */
  nextSlot: NextSlot | null;
}

/** The relic slot to open, named so a stale view never buys the one after (M4c-1). */
export const slotUnlockSchema = z.object({ slot: z.number().int().min(3).max(6) }).strict();
export type SlotUnlock = z.infer<typeof slotUnlockSchema>;

export interface RunStart {
  id: string;
  seed: string;
  sector: string;
  probe: string;
  relics: RelicInput[];
  /**
   * The stat bonuses of the probe's level and of the Laboratorio (M4b-2), and the starting-weapon variant (null: the
   * base), snapshotted at the start.
   */
  bonuses: StatBonus[];
  variant: string | null;
  content: Content;
  contentVersion: number;
  startedAt: string;
}

export interface RunLayerPay {
  layer: number;
  coins: number;
  dust: number;
  multiplier: number;
}

export interface RunResult {
  id: string;
  outcome: 'extracted' | 'died' | 'abandoned';
  ticks: number;
  depth: number;
  kills: number;
  level: number;
  /** `material`: raw material for the station's refinery (M4a). */
  payout: { coins: number; dust: number; signals: number; material: number };
  /**
   * `boosts`: the global multipliers that paid this run (M6d-5), empty when none ran at its finish; absent from results
   * kept before M6d-5 (a resent finish answers what was stored).
   */
  breakdown: { layers: RunLayerPay[]; share: number; daily: { seconds: number; multiplier: number }[]; boosts?: { id: string; name: string; currency: 'coins' | 'dust' | 'material' | 'signal'; factor: number }[] };
  wallet: Wallet;
  /**
   * What the run gave the account (M5a): experience, the level after it and whether it went up, and the season points
   * (0 when it is suspicious or no season is open).
   */
  /** `shards`: the season currency the run paid (M7d-1; absent when none). */
  progress: { xp: number; level: number; levelUp: boolean; points: number; shards?: number };
}
