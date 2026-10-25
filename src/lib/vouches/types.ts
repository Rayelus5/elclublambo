import type { VouchChainId } from "./eas";

/** One received vouch as the app shows it (the attester's Pay alias, or null for a short address). */
export type VouchItem = {
  uid: string;
  chainId: VouchChainId;
  kind: number;
  attester: string;
  attesterAlias: string | null;
  attestedAt: string;
  txHash: string;
};

/** Distinct attesters in total and per kind (Review Focus 5), plus the newest 50 vouches. */
export type VouchesSummary = { total: number; counts: Array<{ kind: number; attesters: number }>; items: VouchItem[] };

/** A non-revoked vouch the address gave (kind and recipient let the form block a duplicate before signing). */
export type GivenVouch = { uid: string; chainId: VouchChainId; kind: number; recipient: string; recipientAlias: string | null; attestedAt: string };

export type VouchError =
  | "not_authenticated"
  | "invalid_input"
  | "chain_unsupported"
  | "pending"
  | "tx_not_found"
  | "tx_failed"
  | "not_a_vouch"
  | "wrong_attester"
  | "self_vouch"
  | "not_found"
  | "rate_limited"
  | "rpc_unavailable"
  | "unknown";

export type RefreshVouchError = "invalid_input" | "not_found" | "rate_limited" | "rpc_unavailable" | "unknown";
