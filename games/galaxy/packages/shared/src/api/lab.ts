import { z } from 'zod';
import type { Wallet } from '../gacha/types';
import type { LabEffects, LabNode } from '../lab/tree';

// The Laboratorio's API (GDD §10.6, M4b-2): the tree with what the account bought, what it adds up to, the wallet,
// and whether the room is repaired (closed until then).

export interface LabNodeView {
  id: string;
  branch: LabNode['branch'];
  name: string;
  effect: LabNode['effect'];
  /** What each level adds (a fraction: 0.02 = 2 %). */
  per: number;
  level: number;
  max: number;
  /** Its requirement has a level (or it has none). */
  unlocked: boolean;
  requires: string | null;
  /** What the next level costs, or null at the top. */
  next: { dust: number; components: number } | null;
}

export interface LabView {
  open: boolean;
  nodes: LabNodeView[];
  effects: LabEffects;
  wallet: Wallet;
}

/** A node's next level, named so a stale view never buys the one after. */
export const labUpgradeSchema = z.object({ level: z.number().int().min(1).max(10) }).strict();
export type LabUpgrade = z.infer<typeof labUpgradeSchema>;
