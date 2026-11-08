import { z } from 'zod';
import { TIERS, type Tier } from '../gacha/types';
import type { GalaxySummary } from './economy';

// The market's API (GDD §14.6; M5c-1): the listings with their rules, one's own listings and sales, listing a galaxy,
// withdrawing it and buying one. Listing and buying carry an idempotency key.

export interface MarketListing {
  id: string;
  galaxy: GalaxySummary;
  seller: string;
  price: number;
  /** ISO. */
  listedAt: string;
  expiresAt: string;
}

/** Who may trade and what the market asks, for the viewer. */
export interface MarketRules {
  /** The share kept of each sale (0.07). */
  commission: number;
  minPrice: Record<Tier, number>;
  maxPrice: number;
  canTrade: boolean;
  reason: 'level' | 'age' | null;
  minLevel: number;
  minAccountDays: number;
  /** What is left of today's caps (Madrid day). */
  listingsLeft: number;
  purchasesLeft: number;
  /** Days a listing stays up. */
  days: number;
}

export interface MarketPage {
  listings: MarketListing[];
  page: number;
  pages: number;
  rules: MarketRules;
}

export interface SoldListing extends MarketListing {
  buyer: string;
  /** What the seller got: the price minus the commission. */
  net: number;
  soldAt: string;
}

export interface MyMarket {
  active: MarketListing[];
  /** The latest sales, newest first. */
  sold: SoldListing[];
  rules: MarketRules;
}

export const MARKET_SORTS = ['new', 'cheap', 'dear'] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

export const marketQuerySchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    sort: z.enum(MARKET_SORTS).default('new'),
    q: z.string().trim().min(1).max(40).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
export type MarketQuery = z.infer<typeof marketQuerySchema>;

export const marketListSchema = z.object({ galaxyId: z.string().uuid(), price: z.number().int().min(1) }).strict();
export type MarketListRequest = z.infer<typeof marketListSchema>;

export const marketIdParamSchema = z.object({ id: z.string().uuid() }).strict();
