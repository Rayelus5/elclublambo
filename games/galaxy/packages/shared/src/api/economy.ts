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
}

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
  /** Dust that disintegrating it pays right now (live config). */
  dust: number;
}

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
}

export interface GachaView {
  banners: BannerView[];
  costs: { coins: number; coinsTen: number; signals: number };
  freePullAvailable: boolean;
  wallet: Wallet;
}

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
