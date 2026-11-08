import { z } from 'zod';
import { usernameSchema } from '../account';
import { TRADE_STATUSES, type TradeStatus } from './trade';

// Trade moderation (GDD §16.4; M6c-2), for admins: the history of listings and trades, cancelling what is still open,
// reverting a sale or a done trade (after seeing where each galaxy went: its lineage), and the suspicious-trade alerts.
// History is never rewritten: a reverted deal keeps its status and gains a reversal.

export const LISTING_STATUSES = ['active', 'sold', 'cancelled', 'expired'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** A page of history or alerts holds 50. */
export const ADMIN_DEALS_PAGE_SIZE = 50;

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const reason = z.string().trim().min(3).max(300);

export const adminDealsQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('listings'), status: z.enum(LISTING_STATUSES).optional(), user: usernameSchema.optional(), page }).strict(),
  z.object({ kind: z.literal('trades'), status: z.enum(TRADE_STATUSES).optional(), user: usernameSchema.optional(), page }).strict(),
]);
export type AdminDealsQuery = z.infer<typeof adminDealsQuerySchema>;
export const adminRevertSchema = z.object({ reason, password: z.string().min(1).max(200) }).strict();
export const adminAlertsQuerySchema = z
  .object({ reviewed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), page })
  .strict();
export const adminDealParamSchema = z.object({ id: z.string().uuid() }).strict();
export const adminAlertParamSchema = z.object({ id: z.string().regex(/^\d{1,18}$/) }).strict();
export const adminLineageQuerySchema = z.object({ kind: z.enum(['listing', 'trade']), id: z.string().uuid() }).strict();

/** A galaxy as the history names it. */
export interface DealGalaxy {
  id: string;
  name: string;
  tier: number;
}

/** A reversal: when, by whom, why, and what could not be taken back (a seller short of coins). */
export interface DealReversal {
  at: string;
  by: string | null;
  reason: string;
  shortfall?: number;
}

export interface AdminListingRow {
  id: string;
  galaxy: DealGalaxy;
  seller: string;
  buyer: string | null;
  price: number;
  commission: number | null;
  status: ListingStatus;
  listedAt: string;
  soldAt: string | null;
  reversal: DealReversal | null;
}

export interface AdminTradeRow {
  id: string;
  a: string;
  b: string;
  aGalaxy: DealGalaxy | null;
  bGalaxy: DealGalaxy | null;
  status: TradeStatus;
  createdAt: string;
  closedAt: string | null;
  reversal: DealReversal | null;
}

export type AdminDealsPage = { kind: 'listings'; rows: AdminListingRow[]; page: number; pages: number } | { kind: 'trades'; rows: AdminTradeRow[]; page: number; pages: number };

/** A later move of a galaxy, after the deal being reverted. */
export interface LaterMove {
  kind: 'sale' | 'trade';
  id: string;
  at: string;
  from: string;
  to: string;
}

/** Where a galaxy moved by a deal is now, and whether it can go back. */
export interface GalaxyLineage {
  galaxy: DealGalaxy;
  /** Who gave it and who received it in this deal. */
  from: string;
  to: string;
  /** Who holds it now (null when it is gone). */
  owner: string | null;
  /** Disintegrated, fused or taken back by an admin. */
  gone: boolean;
  /** The galaxy a fusion made from it, and its owner. */
  fusedInto: { galaxy: DealGalaxy; owner: string } | null;
  laterMoves: LaterMove[];
  /** Alive, still with its receiver and never moved since. */
  returnable: boolean;
}

export interface DealLineage {
  galaxies: GalaxyLineage[];
  returnable: boolean;
  /** Already reverted. */
  reversal: DealReversal | null;
}

export interface AdminAlertRow {
  id: string;
  kind: 'shared_ip' | 'unbalanced';
  /** The sale or the trade it is about. */
  deal: { kind: 'listing' | 'trade'; id: string } | null;
  seller: string | null;
  buyer: string | null;
  details: Record<string, unknown>;
  at: string;
  review: { at: string; by: string | null; reason: string } | null;
}

export interface AdminAlertsPage {
  rows: AdminAlertRow[];
  page: number;
  pages: number;
}
