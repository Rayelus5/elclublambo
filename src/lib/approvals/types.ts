// ERC-20 approvals (P6-R2/R2b): what the approvals page lists and how a scan can end.

/** «known»: on the short list of labelled spenders; «eoa»: no code (the classic scam pattern); else an unknown contract. */
export type SpenderKind = "known" | "unknown_contract" | "eoa";

export type ApprovalRow = {
  token: `0x${string}`;
  symbol: string | null;
  decimals: number | null;
  spender: `0x${string}`;
  spenderLabel: string | null;
  spenderKind: SpenderKind;
  /** The live allowance in token base units (decimal string; always > 0 in a listed row). */
  allowance: string;
  unlimited: boolean;
};

export type ApprovalUnavailableReason = "blocked" | "timeout" | "rate_limited" | "error";

/** An unavailable scan is never «no approvals»: the page falls back to the manual check (Review Focus 1). */
export type ApprovalScan =
  | { status: "ok"; rows: ApprovalRow[]; partial: boolean }
  | { status: "unavailable"; reason: ApprovalUnavailableReason };

/** An allowance at or above 2^255 is shown as «Ilimitada» (wallets approve maxUint256, some decrement it on use). */
export const UNLIMITED_THRESHOLD = 2n ** 255n;
