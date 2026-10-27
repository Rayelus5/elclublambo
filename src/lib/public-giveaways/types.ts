// Public giveaway shapes as public_giveaway_view / my_public_giveaways return them (supabase/migrations/
// 20261025100002_public_giveaways.sql). Amounts stay `string` (USDC base units); nothing here is a club type (D15).
import type { ChainId } from "@/lib/economy/networks";

export const PUBLIC_GIVEAWAY_STATUSES = ["open", "closed", "drawn", "void", "cancelled"] as const;
export type PublicGiveawayStatus = (typeof PUBLIC_GIVEAWAY_STATUSES)[number];

export const PUBLIC_PRIZE_STATUSES = ["pending", "awarded", "unawarded", "paid", "delivered"] as const;
export type PublicPrizeStatus = (typeof PUBLIC_PRIZE_STATUSES)[number];

export interface PublicPrize {
  id: string;
  rank: number;
  kind: "crypto" | "custom";
  chainId: number | null;
  token: string | null;
  /** USDC base units as text; crypto only. */
  amount: string | null;
  label: string;
  status: PublicPrizeStatus;
  unawardedReason: string | null;
  winnerPosition: number | null;
  winnerAddress: string | null;
  payoutTxHash: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
}

export interface PublicEntry {
  /** null while the giveaway is open (positions are assigned at the close). */
  position: number | null;
  walletAddress: string;
}

export interface PublicGiveawayView {
  id: string;
  title: string;
  description: string | null;
  hostName: string | null;
  hostAddress: string;
  closesAt: string;
  status: PublicGiveawayStatus;
  targetRound: number;
  seedCommit: string;
  seedReveal: string | null;
  drandSignature: string | null;
  drandRandomness: string | null;
  entryCount: number;
  minTxCount: number;
  hasAllowlist: boolean;
  isHost: boolean;
  iEntered: boolean;
  drawnAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  entries: PublicEntry[];
  prizes: PublicPrize[];
}

export interface PublicGiveawayCard {
  id: string;
  title: string;
  status: PublicGiveawayStatus;
  closesAt: string;
  entryCount: number;
  prizeCount: number;
}

export type PublicPrizeInput = { kind: "crypto"; chainId: ChainId; amount: string } | { kind: "custom"; label: string };

export type PublicGiveawayInput = {
  title: string;
  description: string;
  closesAt: string;
  hostName: string;
  minTxCount: number;
  /** Pasted text: addresses separated by line breaks, commas or spaces. */
  allowlist: string;
  prizes: PublicPrizeInput[];
};

/** Every code the public giveaway actions can return; the text lives in the dictionaries. */
export type PublicGiveawayError =
  | "not_authenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "invalid_state"
  | "invalid_allowlist"
  | "chain_invalid"
  | "chain_unavailable"
  | "min_tx_not_met"
  | "not_allowed"
  | "giveaway_closed"
  | "giveaway_full"
  | "too_many_open"
  | "tx_already_used"
  | "tx_not_found"
  | "tx_failed"
  | "tx_mismatch"
  | "tx_too_old"
  | "rpc_unavailable"
  | "pending"
  | "rate_limited"
  | "retry"
  | "unknown";

export type PublicFail = { ok: false; error: PublicGiveawayError; detail?: string };
