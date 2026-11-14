import { z } from 'zod';
import { TIERS, type Tier } from '../gacha/types';
import type { PublicGalaxy } from './planetarium';
import { tradeDealSideSchema } from './trade';

// The public trade board (the owner, 2026-11-14: «un tablón público» of trades): a post says what its author gives (up
// to `market.tradeGalaxies` galaxies and/or coins) and what they are after (rarities, a type, a palette, a phenomenon,
// or coins; nothing named means any proposal), with a short note. Anyone answers with a trade that asks what the post
// gives; the author accepting one closes the post and cancels the other answers. Nothing of a post is held.

export const TRADE_POST_STATUSES = ['open', 'closed', 'cancelled', 'expired'] as const;
export type TradePostStatus = (typeof TRADE_POST_STATUSES)[number];

const traitValue = z.string().regex(/^[a-z0-9_-]{1,32}$/);

/** What a post's author is after. Nothing named: any proposal. */
export const tradeWantsSchema = z
  .object({
    tiers: z
      .array(z.enum(TIERS))
      .max(TIERS.length)
      .refine((t) => new Set(t).size === t.length, 'each rarity once'),
    type: traitValue.optional(),
    palette: traitValue.optional(),
    phenomenon: traitValue.optional(),
    coins: z.boolean(),
  })
  .strict();
export type TradeWants = z.infer<typeof tradeWantsSchema>;

export const NO_WANTS: TradeWants = { tiers: [], coins: false };

export const tradePostSchema = z.object({ give: tradeDealSideSchema, wants: tradeWantsSchema, note: z.string().trim().max(140) }).strict();
export type TradePostInput = z.infer<typeof tradePostSchema>;

export const tradeBoardQuerySchema = z.object({ cursor: z.string().max(400).optional(), tier: z.enum(TIERS).optional() }).strict();
export type TradeBoardQuery = z.infer<typeof tradeBoardQuerySchema>;

export const tradePostIdParamSchema = z.object({ id: z.string().uuid() }).strict();

export interface TradePostView {
  id: string;
  author: string;
  /** It is the viewer's own. */
  mine: boolean;
  /** What it gives: its galaxies still the author's (the rarest first) and its coins. */
  galaxies: PublicGalaxy[];
  coins: number;
  wants: TradeWants;
  note: string;
  status: TradePostStatus;
  /** ISO. */
  createdAt: string;
  expiresAt: string;
  /** Its open answers. */
  answers: number;
  /** The viewer's open answer to it (a trade id), if any. */
  myAnswer: string | null;
}

export interface TradeBoardRules {
  canPost: boolean;
  /** Posts the viewer may still have open, and make today. */
  openLeft: number;
  todayLeft: number;
  days: number;
  /** Open answers a post takes. */
  answers: number;
}

/** GET /trades/board: a page of open posts, the newest first; `next` goes on from the last one. */
export interface TradeBoardPage {
  posts: TradePostView[];
  next: string | null;
  rules: TradeBoardRules;
}

/** GET /trades/posts/mine: my posts, the open ones first, then the latest. */
export interface MyTradePosts {
  posts: TradePostView[];
  rules: TradeBoardRules;
}

/** A post asks something when it names a rarity, a trait or coins; else it takes any proposal. */
export const wantsSomething = (w: TradeWants): boolean => w.tiers.length > 0 || !!w.type || !!w.palette || !!w.phenomenon || w.coins;

/** Rarities in their order, for showing what a post is after. */
export const sortTiers = (tiers: readonly Tier[]): Tier[] => [...tiers].sort((a, b) => TIERS.indexOf(a) - TIERS.indexOf(b));
