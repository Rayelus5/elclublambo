import { z } from 'zod';
import { usernameSchema } from '../account';
import type { MarketRules } from './market';
import type { PublicGalaxy } from './planetarium';

// The swap between two players (GDD §14.5; M5c-2): one galaxy for one galaxy. What each side gives stays in escrow;
// every change makes a new version, and the swap runs when both confirmed the same one. Changing or confirming names the
// version the player saw.

export const TRADE_STATUSES = ['open', 'done', 'cancelled', 'expired'] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export interface TradeSide {
  /** What this side gives, or null while it gives nothing yet. */
  galaxy: PublicGalaxy | null;
  /** It confirmed the current version. */
  confirmed: boolean;
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
}

export interface MyTrades {
  open: TradeView[];
  /** The latest closed ones (done, cancelled or expired), newest first. */
  closed: TradeView[];
  rules: MarketRules & { openTrades: number; tradesLeft: number; tradeDays: number };
}

export const tradeProposeSchema = z.object({ username: usernameSchema, give: z.string().uuid(), want: z.string().uuid().optional() }).strict();
export type TradePropose = z.infer<typeof tradeProposeSchema>;

export const tradeOfferSchema = z
  .object({ give: z.string().uuid().nullable(), want: z.string().uuid().nullable(), version: z.number().int().min(1) })
  .strict();
export type TradeOffer = z.infer<typeof tradeOfferSchema>;

export const tradeConfirmSchema = z.object({ version: z.number().int().min(1) }).strict();
export const tradeIdParamSchema = z.object({ id: z.string().uuid() }).strict();
