// Giveaway shapes as the member-facing RPCs return them (giveaways_list, giveaway_detail in
// supabase/migrations/20261024200006_giveaways.sql), with amounts as bigint.

export const GIVEAWAY_STATUSES = ["open", "closed", "drawn", "void", "cancelled"] as const;
export type GiveawayStatus = (typeof GIVEAWAY_STATUSES)[number];

export const PRIZE_KINDS = ["crypto", "role", "custom"] as const;
export type PrizeKind = (typeof PRIZE_KINDS)[number];

export const PRIZE_STATUSES = ["pending", "awarded", "unawarded", "paid", "delivered"] as const;
export type PrizeStatus = (typeof PRIZE_STATUSES)[number];

export const UNAWARDED_REASONS = ["not_enough_entries", "role_unavailable", "winner_inactive"] as const;
export type UnawardedReason = (typeof UNAWARDED_REASONS)[number];

export interface GiveawayPrize {
  rank: number;
  kind: PrizeKind;
  label: string;
  chainId: number | null;
  /** USDC base units (6 decimals); crypto prizes only. */
  amount: bigint | null;
}

export interface GiveawayWinner {
  rank: number;
  label: string | null;
  iWon: boolean;
}

export interface GiveawayCard {
  id: string;
  title: string;
  closesAt: string;
  status: GiveawayStatus;
  entryCount: number;
  iEntered: boolean;
  prizes: GiveawayPrize[];
  /** The prizes that went to someone (awarded, paid, delivered), by rank. */
  winners: GiveawayWinner[];
}

export interface GiveawayEntry {
  /** 1..n once closed (every entry, frozen at closes_at); null before. */
  position: number | null;
  label: string | null;
  isMe: boolean;
}

export interface GiveawayPrizeState extends GiveawayPrize {
  id: string;
  token: "USDC" | null;
  status: PrizeStatus;
  unawardedReason: UnawardedReason | null;
  winnerPosition: number | null;
  winnerLabel: string | null;
  iWon: boolean;
  /** Only for treasurers and the winner. */
  winnerAddress: string | null;
  payoutTxHash: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
}

export interface GiveawayDetail extends GiveawayCard {
  description: string | null;
  /** keccak256(seed), published at creation. */
  commit: string;
  /** The seed, revealed at the draw or on void. */
  seedReveal: string | null;
  targetRound: bigint;
  /** 96 hex, no 0x. */
  drandSignature: string | null;
  /** sha256(signature), 64 hex, no 0x. */
  drandRandomness: string | null;
  drawnAt: string | null;
  cancelReason: string | null;
  entries: GiveawayEntry[];
  prizeStates: GiveawayPrizeState[];
}
