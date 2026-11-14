import { z } from 'zod';
import { FINISHES, TIERS, type Tier } from '../gacha/types';
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
  /** Open offers on it (2026-11-14), and the viewer's own (its amount), if any. */
  offers?: number;
  myOffer?: number | null;
}

/** Who may trade and what the market asks, for the viewer. */
export interface MarketRules {
  /** The share kept of each sale (0.07). */
  commission: number;
  minPrice: Record<Tier, number>;
  /** A mythic may be put up for sale (off by default). */
  mythicListing: boolean;
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
  /** Offers (2026-11-14): how long one lasts, and what is left of the viewer's open ones and today's. */
  offers: { enabled: boolean; hours: number; openLeft: number; todayLeft: number };
}

/**
 * A page of listings (the owner, 2026-11-14: a market «profesional para 100.000 anuncios»): `next` reads the ones after
 * (keyset: the listings that came meanwhile never shift what is shown, and nothing is counted).
 */
export interface MarketPage {
  listings: MarketListing[];
  next: string | null;
  rules: MarketRules;
}

export interface MarketStatsWindow {
  sales: number;
  /** Gold paid for them, and the commission that left the economy. */
  gold: number;
  commission: number;
}

/** The market's public numbers (refreshed every few minutes by the market's job). */
export interface MarketStats {
  updatedAt: string | null;
  /** The last 24 hours and the last 7 days. */
  day: MarketStatsWindow;
  week: MarketStatsWindow & { trades: number };
  /** Listings on sale now. */
  active: number;
  /** The last 7 days by rarity: sales and the average price. */
  byTier: Partial<Record<Tier, { sales: number; avg: number }>>;
  /** The dearest sale of the last 7 days. */
  top: { name: string; tier: Tier; price: number; at: string } | null;
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

/** Newest, cheapest, dearest, rarest, ending soonest and highest level first. */
export const MARKET_SORTS = ['new', 'cheap', 'dear', 'rare', 'ending', 'level'] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

const trait = z.string().regex(/^[a-z_]{1,24}$/);
const amount = z.coerce.number().int().min(1).max(1_000_000_000);
const lvl = z.coerce.number().int().min(1).max(99);

/**
 * What the market is searched by: rarity, finish, a galaxy's type, palette and phenomenon (`any`: with one, `none`:
 * without), levels and prices from and to, words of its name or designation; in an order; `cursor` goes on from a page.
 */
export const marketQuerySchema = z
  .object({
    tier: z.enum(TIERS).optional(),
    finish: z.enum(FINISHES).optional(),
    type: trait.optional(),
    palette: trait.optional(),
    phenomenon: trait.optional(),
    minLevel: lvl.optional(),
    maxLevel: lvl.optional(),
    minPrice: amount.optional(),
    maxPrice: amount.optional(),
    q: z.string().trim().min(1).max(40).optional(),
    sort: z.enum(MARKET_SORTS).default('new'),
    cursor: z.string().regex(/^[A-Za-z0-9_-]{1,400}$/).optional(),
  })
  .strict();
export type MarketQuery = z.infer<typeof marketQuerySchema>;

export const marketListSchema = z.object({ galaxyId: z.string().uuid(), price: z.number().int().min(1) }).strict();
export type MarketListRequest = z.infer<typeof marketListSchema>;

export const marketIdParamSchema = z.object({ id: z.string().uuid() }).strict();

/** What an offer can be now, and after. */
export const OFFER_STATUSES = ['open', 'accepted', 'rejected', 'outbid', 'expired', 'closed', 'withdrawn'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

/** An offer on a listing (the owner, 2026-11-14): its coins are held from the buyer until it ends. */
export interface MarketOffer {
  id: string;
  listing: { id: string; galaxy: GalaxySummary; price: number; seller: string; active: boolean };
  buyer: string;
  amount: number;
  status: OfferStatus;
  createdAt: string;
  expiresAt: string;
  closedAt: string | null;
}

/** GET /market/offers: the ones on my listings and mine, the open first, then the latest. */
export interface MarketOffersView {
  received: MarketOffer[];
  sent: MarketOffer[];
  /** My coins held in open offers. */
  held: number;
}

export const marketOfferSchema = z.object({ amount: z.number().int().min(1).max(1_000_000_000) }).strict();
