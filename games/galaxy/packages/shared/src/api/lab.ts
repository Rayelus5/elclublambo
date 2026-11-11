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
  /** What it gives now and what the next level adds (fractions, computed on the server: the UI does no maths). */
  now: number;
  nextGain: number;
  /** The whiteboard's layout hint, if any. */
  at: LabNode['at'];
}

export interface LabView {
  open: boolean;
  /** The permanent tree. */
  nodes: LabNodeView[];
  /** The season's tree while a season is open with one (it starts empty every season), or null. */
  season: { id: string; name: string; endsAt: string; nodes: LabNodeView[] } | null;
  effects: LabEffects;
  wallet: Wallet;
}

/** A node's next level, named so a stale view never buys the one after; a season's node names its season too. */
export const labUpgradeSchema = z
  .object({ level: z.number().int().min(1).max(10), season: z.string().regex(/^[a-z0-9-]{1,32}$/).optional() })
  .strict();
export type LabUpgrade = z.infer<typeof labUpgradeSchema>;
