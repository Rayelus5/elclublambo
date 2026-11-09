import { z } from 'zod';
import type { GalaxySummary } from '../api/economy';
import { FINISHES, type Finish, type Tier, TIERS, type Wallet } from './types';

// The automatic fusion (multiplayer plan, phase 2): for players with a bulk of galaxies, it fuses every group of
// `fusion.count` same-tier galaxies, from one tier up to a top one, in a chain (the galaxies a fusion makes join the
// next tier's pool). It only takes what the player could fuse by hand, and never what they keep: locked galaxies
// always, special finishes and levelled galaxies unless told otherwise, and anything equipped, exhibited, for sale or
// in a swap. The collection's filters (type, palette, finish) narrow what it may take. The plan below is pure: the
// preview counts what would happen (an upper bound, since a new galaxy's finish is drawn), and the server runs the
// same order for real.

/** Finishes kept by default: every drawn finish but the plain one. */
export const SPECIAL_FINISHES: readonly Finish[] = FINISHES.filter((f) => f !== 'normal');
/** Fusions one request makes at most (a bigger bulk takes several presses). */
export const AUTO_FUSION_CAP = 100;

const filterValue = z.string().regex(/^[a-z_]{1,24}$/);

export const autoFusionCriteriaSchema = z
  .object({
    /** The lowest tier it takes, and the tier it stops at (galaxies of `upTo` are kept). */
    from: z.enum(['common', 'uncommon', 'rare', 'epic']),
    upTo: z.enum(['uncommon', 'rare', 'epic', 'legendary']),
    type: filterValue.optional(),
    palette: filterValue.optional(),
    finish: z.enum(FINISHES).optional(),
    /** Keep galaxies with a special finish (holo, prismatic…). */
    keepFinishes: z.boolean().default(true),
    /** Keep galaxies with levels (dust put into them). */
    keepLeveled: z.boolean().default(true),
  })
  .strict()
  .refine((c) => TIERS.indexOf(c.upTo) > TIERS.indexOf(c.from), 'auto_fusion_range');
export type AutoFusionCriteria = z.output<typeof autoFusionCriteriaSchema>;

export const autoFusionRequestSchema = z.object({ criteria: autoFusionCriteriaSchema, preview: z.boolean().default(false) }).strict();
export type AutoFusionRequest = z.input<typeof autoFusionRequestSchema>;

/** A galaxy as the plan sees it. `busy`: equipped, exhibited, for sale or in a swap. */
export interface AutoFusionCandidate {
  id: string;
  tier: number;
  finish: Finish;
  level: number;
  score: number;
  createdAt: string;
  locked: boolean;
  busy: boolean;
  type: string;
  palette: string;
}

export interface AutoFusionStep {
  from: Tier;
  to: Tier;
  fusions: number;
  dust: number;
}

export interface AutoFusionPreview {
  steps: AutoFusionStep[];
  fusions: number;
  dust: number;
  /** The account's dust: when short, the plan stops where it runs out. */
  wallet: number;
  short: boolean;
  /** Stopped at AUTO_FUSION_CAP fusions (press again for the rest). */
  limited: boolean;
  /** Galaxies of the chosen tiers and filters it leaves alone, by why (each counted once, in this order). */
  kept: { busy: number; locked: number; finishes: number; leveled: number };
}

export interface AutoFusionResult {
  /** The galaxies it made, best first. */
  galaxies: GalaxySummary[];
  fusions: number;
  dust: number;
  /** More could be fused with the same criteria (the cap was reached). */
  more: boolean;
  wallet: Wallet;
}

/** Whether the filters let the plan look at `g` (tier aside). */
function matches(g: Pick<AutoFusionCandidate, 'finish' | 'type' | 'palette'>, c: AutoFusionCriteria): boolean {
  return (!c.type || g.type === c.type) && (!c.palette || g.palette === c.palette) && (!c.finish || g.finish === c.finish);
}

/** Why the plan keeps `g`, or null when it may fuse it. */
export function keptBecause(g: AutoFusionCandidate, c: AutoFusionCriteria): keyof AutoFusionPreview['kept'] | null {
  if (g.busy) return 'busy';
  if (g.locked) return 'locked';
  if (c.keepFinishes && SPECIAL_FINISHES.includes(g.finish)) return 'finishes';
  if (c.keepLeveled && g.level > 1) return 'leveled';
  return null;
}

/** May the plan take `g`: a tier it fuses, the filters, and nothing that keeps it. */
export function autoFusible(g: AutoFusionCandidate, c: AutoFusionCriteria): boolean {
  const t = g.tier;
  return t >= TIERS.indexOf(c.from) && t < TIERS.indexOf(c.upTo) && matches(g, c) && keptBecause(g, c) === null;
}

/** The order a tier's pool is spent in: lowest score first, then the oldest (and the id, so it is total). */
export function fusionOrder<T extends Pick<AutoFusionCandidate, 'score' | 'createdAt' | 'id'>>(list: T[]): T[] {
  return [...list].sort((a, b) => a.score - b.score || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * What the automatic fusion would do with `candidates` (the owner's live galaxies): per tier, how many groups of
 * `recipe.count` it fuses and their dust (`recipe.dust[tier]`, discounts applied), counting the new galaxies of the
 * tier below as fusible (an upper bound). It stops when the dust runs out or at `cap` fusions.
 */
export function planAutoFusion(
  candidates: readonly AutoFusionCandidate[],
  c: AutoFusionCriteria,
  recipe: { count: number; dust: readonly number[] },
  wallet: number,
  cap = AUTO_FUSION_CAP,
): AutoFusionPreview {
  const lo = TIERS.indexOf(c.from);
  const hi = TIERS.indexOf(c.upTo);
  const kept = { busy: 0, locked: 0, finishes: 0, leveled: 0 };
  const pool = TIERS.map(() => 0);
  for (const g of candidates) {
    if (g.tier < lo || g.tier >= hi || !matches(g, c)) continue;
    const why = keptBecause(g, c);
    if (why) kept[why]++;
    else pool[g.tier]!++;
  }
  const steps: AutoFusionStep[] = [];
  let fusions = 0;
  let dust = 0;
  let short = false;
  let limited = false;
  for (let t = lo; t < hi; t++) {
    const cost = recipe.dust[t] ?? 0;
    let n = 0;
    while (pool[t]! >= recipe.count) {
      if (fusions >= cap) {
        limited = true;
        break;
      }
      if (dust + cost > wallet) {
        short = true;
        break;
      }
      pool[t] = pool[t]! - recipe.count;
      n++;
      fusions++;
      dust += cost;
    }
    if (n > 0) steps.push({ from: TIERS[t]!, to: TIERS[t + 1]!, fusions: n, dust: n * cost });
    if (t + 1 < hi) pool[t + 1] = pool[t + 1]! + n;
    if (short || limited) break;
  }
  return { steps, fusions, dust, wallet, short, limited, kept };
}
