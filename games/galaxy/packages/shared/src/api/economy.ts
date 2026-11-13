import { z } from 'zod';
import type { Finish, Tier, Wallet } from '../gacha/types';

// Requests and responses of the economy, gacha and collection API (GDD §9, §8.5). Requests are validated with these
// schemas on the server; every mutating call also carries an `Idempotency-Key` header (a UUID from the client).

export const pullRequestSchema = z
  .object({
    banner: z.string().regex(/^[a-z0-9-]{1,32}$/),
    count: z.union([z.literal(1), z.literal(10)]),
    pay: z.enum(['coins', 'signal', 'free']),
  })
  .strict();
export type PullRequest = z.infer<typeof pullRequestSchema>;

export const fuseRequestSchema = z
  .object({ ids: z.array(z.uuid()).min(2).max(10) })
  .strict()
  .refine((r) => new Set(r.ids).size === r.ids.length, 'duplicate_ids');
export type FuseRequest = z.infer<typeof fuseRequestSchema>;

/** How many galaxies one «Desintegrar varias» takes at most. */
export const DISINTEGRATE_MAX = 50;
/**
 * Desintegrar varias (the owner: by selection, as when fusing): 1 to 50 different galaxies, all or none. With `preview`
 * the server only says how many and how much dust, and changes nothing (no idempotency key needed).
 */
export const disintegrateManySchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(DISINTEGRATE_MAX), preview: z.boolean().optional() })
  .strict()
  .refine((r) => new Set(r.ids).size === r.ids.length, 'duplicate_ids');
export type DisintegrateManyRequest = z.infer<typeof disintegrateManySchema>;
export interface DisintegrateManyPreview {
  count: number;
  /** Dust for all of them, as if one by one (the lab's Reciclaje and the relic refunds included). */
  dust: number;
}

/** Engine traits as stored (keys in draw order; arms/inclination only where they apply). */
export type GalaxyTraits = Record<string, string>;

export interface PulledGalaxy {
  id: string;
  /** 64-bit seed as a decimal string: the client renders it with renderFromSeed(seed). */
  seed: string;
  tier: Tier;
  finish: Finish;
  traits: GalaxyTraits;
  name: string;
  designation: string;
  featured: boolean;
}

export interface GalaxySummary extends PulledGalaxy {
  level: number;
  createdAt: string;
  /** Equipped as a relic in the hangar (it cannot be disintegrated or fused until removed). Absent: not equipped. */
  equipped?: boolean;
  /** On a pedestal of the planetarium (it cannot be disintegrated or fused until taken down; M4c-2). Absent: not exhibited. */
  exhibited?: true;
  /** For sale in the market (in escrow until sold, withdrawn or expired; M5c-1). Absent: not listed. */
  listed?: true;
  /** Offered in an open swap (in escrow until it closes; M5c-2). Absent: not offered. */
  traded?: true;
  /** Locked by its owner (multiplayer plan, phase 2): never fused nor disintegrated until unlocked. Absent: not locked. */
  locked?: true;
}

/** Locks or unlocks a galaxy. */
export const galaxyLockSchema = z.object({ locked: z.boolean() }).strict();

/** A parent of a fused galaxy: it no longer exists, but its name stays in the lineage. */
export interface LineageEntry {
  id: string;
  name: string;
  designation: string;
  tier: Tier;
}

export interface GalaxyDetail extends GalaxySummary {
  origin: 'pull' | 'fusion' | 'grant';
  lineage: LineageEntry[];
  dna: string;
  /** Dust that disintegrating it pays right now (live config), the refund of its levels included. */
  dust: number;
  /** Its next level's dust (M4c-1), or null at level 10. */
  levelUp: { dust: number } | null;
  /** What fusing or disintegrating it returns of the dust put into its levels. */
  refund: number;
}

/** A galaxy's next level, named so a stale view never buys the one after (M4c-1). */
export const relicLevelUpSchema = z.object({ level: z.number().int().min(2).max(10) }).strict();
export type RelicLevelUp = z.infer<typeof relicLevelUpSchema>;

export interface BannerView {
  id: string;
  kind: 'standard' | 'event';
  name: string;
  currency: string;
  featured?: { trait: string; value: string };
  endsAt?: string;
  /** Probability of each tier on the next pull (common → legendary), rising luck included. */
  nextRates: number[];
  /** Pulls since the last legendary, and how many more until it is guaranteed. */
  sinceLegendary: number;
  untilGuarantee: number;
  welcome: boolean;
  /** Event banners: pulls until the featured galaxy is guaranteed. */
  untilFeatured?: number;
  /** Event banners: the guarantee's length (pulls from one featured galaxy to the next certain one). */
  featuredEvery?: number;
}

/** Event signals left over when their scanner closed, already turned into star dust; shown once (open beta). */
export interface LeftoverView {
  id: string;
  /** The event's name (or its scanner's) when it was converted. */
  label: string;
  signals: number;
  dust: number;
}

export interface GachaView {
  banners: BannerView[];
  costs: { coins: number; coinsTen: number; signals: number };
  freePullAvailable: boolean;
  wallet: Wallet;
  /** Conversions the player has not seen yet. */
  leftovers?: LeftoverView[];
  /** The resource shop for this account (shop and lab plan, F5): open (its links show) and with an offer running. */
  shop?: { open: boolean; offer: boolean };
}

/** The conversions the player has now seen. */
export const leftoversSeenSchema = z.object({ ids: z.array(z.string().regex(/^[0-9]{1,18}$/)).min(1).max(50) }).strict();

export interface PullResponse {
  pulls: PulledGalaxy[];
  wallet: Wallet;
  view: GachaView;
}

export interface CollectionPage {
  items: GalaxySummary[];
  next?: string;
  counts: Record<Tier, number>;
  /** The live fusion recipe: `count` of one tier → the next, for `dust[tier]` (common → epic). */
  fusion: { count: number; dust: number[] };
}
