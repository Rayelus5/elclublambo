import { z } from 'zod';
import { usernameSchema } from '../account';
import type { Tier } from '../gacha/types';
import type { MarketRules } from './market';
import type { PublicGalaxy } from './planetarium';

// The swap between two players (GDD §14.5; M5c-2, trades 2.0 on 2026-11-14): each side gives up to
// `market.tradeGalaxies` galaxies and, one side at most, coins. What each side offers stays in escrow (the coins held);
// every change makes a new version, and the swap runs when both confirmed the same one. Changing or confirming names
// the version the player saw. Every proposal and counter-offer is kept, for the history both sides see.

export const TRADE_STATUSES = ['open', 'done', 'cancelled', 'expired'] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

/** The most galaxies a side may give, whatever the config says (the config's `market.tradeGalaxies` is at most this). */
export const TRADE_GALAXIES_MAX = 6;

export interface TradeSide {
  /** What this side gives: its galaxies (the rarest first) and its coins. */
  galaxies: PublicGalaxy[];
  coins: number;
  /** It confirmed the current version. */
  confirmed: boolean;
}

export const TRADE_EVENT_KINDS = ['proposed', 'countered', 'confirmed', 'done', 'cancelled'] as const;
export type TradeEventKind = (typeof TRADE_EVENT_KINDS)[number];

/** A galaxy as a trade's history names it: as it was then. */
export interface TradeDealGalaxy {
  id: string;
  name: string;
  tier: Tier;
}

export interface TradeDealSide {
  galaxies: TradeDealGalaxy[];
  coins: number;
}

/** One step of a trade's history, from the viewer's side. */
export interface TradeEvent {
  version: number;
  kind: TradeEventKind;
  /** I did it (else the other side did). */
  byMe: boolean;
  /** ISO. */
  at: string;
  /** The deal a proposal or a counter-offer made, from my side; null for the rest. */
  deal: { me: TradeDealSide; them: TradeDealSide } | null;
}

export interface TradeView {
  id: string;
  version: number;
  status: TradeStatus;
  /** ISO. */
  createdAt: string;
  expiresAt: string;
  /** Who proposed it. */
  proposedByMe: boolean;
  me: TradeSide;
  them: TradeSide & { username: string };
  /** The coins the market kept when coins changed hands (done trades), else null. */
  commission: number | null;
  /** What happened, oldest first (the latest 30). */
  history: TradeEvent[];
  /** The board post it answers (2026-11-14), if any. */
  post: string | null;
}

export interface MyTrades {
  open: TradeView[];
  /** The latest closed ones (done, cancelled or expired), newest first. */
  closed: TradeView[];
  rules: MarketRules & { openTrades: number; tradesLeft: number; tradeDays: number; tradeGalaxies: number };
}

/** One side of a deal as sent: its galaxies (ids) and its coins. */
export const tradeDealSideSchema = z
  .object({
    galaxies: z
      .array(z.string().uuid())
      .max(TRADE_GALAXIES_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'each galaxy once'),
    coins: z.number().int().min(0).max(1_000_000_000),
  })
  .strict();
export type TradeDealInput = z.infer<typeof tradeDealSideSchema>;

export const NO_DEAL: TradeDealInput = { galaxies: [], coins: 0 };

/** Proposing; with `post`, it answers that board post (its `want` is what the post gives). */
export const tradeProposeSchema = z.object({ username: usernameSchema, give: tradeDealSideSchema, want: tradeDealSideSchema, post: z.string().uuid().optional() }).strict();
export type TradePropose = z.infer<typeof tradeProposeSchema>;

export const tradeOfferSchema = z.object({ give: tradeDealSideSchema, want: tradeDealSideSchema, version: z.number().int().min(1) }).strict();
export type TradeOffer = z.infer<typeof tradeOfferSchema>;

export const tradeConfirmSchema = z.object({ version: z.number().int().min(1) }).strict();
export const tradeIdParamSchema = z.object({ id: z.string().uuid() }).strict();

/** A side gives something: a galaxy or coins. */
export const givesSomething = (s: { galaxies: readonly unknown[]; coins: number }): boolean => s.galaxies.length > 0 || s.coins > 0;

/**
 * What is wrong with a deal before the server looks at whose galaxies they are (null when nothing): too many galaxies
 * on a side, the same galaxy on both, coins on both sides (the gold goes one way), or more coins than the market's
 * highest price. Both sides giving something makes it complete; with coins on one side only, a complete deal always
 * moves a galaxy.
 */
export function dealProblem(give: TradeDealInput, want: TradeDealInput, rules: { tradeGalaxies: number; maxPrice: number }): 'trade_too_many' | 'trade_duplicate' | 'trade_coins_both' | 'price_too_high' | null {
  if (give.galaxies.length > rules.tradeGalaxies || want.galaxies.length > rules.tradeGalaxies) return 'trade_too_many';
  if (give.galaxies.some((g) => want.galaxies.includes(g))) return 'trade_duplicate';
  if (give.coins > 0 && want.coins > 0) return 'trade_coins_both';
  if (give.coins > rules.maxPrice || want.coins > rules.maxPrice) return 'price_too_high';
  return null;
}
