import type { ChainId } from "@/lib/economy/networks";

/** Why a section could not be answered. A section in this state never adds nor removes confidence (P4, «Desconocido»). */
export type UnknownReason = "timeout" | "blocked" | "rate_limited" | "error" | "unsupported" | "not_indexed";

export type Section<T> = { status: "ok"; data: T } | { status: "unknown"; reason: UnknownReason };

export type Erc20Data = { name: string | null; symbol: string | null; decimals: number; totalSupply: string };
export type ProxyData = { isProxy: boolean; implementation: string | null };
export type OwnerData = { owner: string | null; renounced: boolean };
/** `abiFlags: null` = verified, but its ABI could not be read: the privileged functions are unknown (not «none»). */
export type VerificationData = { verified: boolean; source: "blockscout" | "sourcify"; abiFlags: string[] | null };
/**
 * `ageUnknown` is set when the age could not be read: the creation transaction exists but its time did not come back,
 * or the explorer has not indexed a contract yet (`not_indexed`). The age then shows «Desconocido» (null `ageDays`
 * with `ageUnknown: null` = no creation transaction known at all).
 */
export type CreationData = {
  creator: string | null;
  createdAt: string | null;
  ageDays: number | null;
  ageUnknown: UnknownReason | null;
  isScam: boolean;
};
export type MarketData = {
  pairs: number;
  liquidityUsd: number | null;
  priceUsd: string | null;
  fdv: number | null;
  topPairUrl: string | null;
};

/**
 * Everything the checker learned about an address, one section per source. `erc20: ok null` = the address answers but
 * is not an ERC-20 (no code, or no `decimals()`); `owner: ok null` = there is no `owner()` to read.
 */
export type TokenFacts = {
  chainId: ChainId;
  address: string;
  code: Section<{ hasCode: boolean }>;
  erc20: Section<Erc20Data | null>;
  proxy: Section<ProxyData>;
  owner: Section<OwnerData | null>;
  verification: Section<VerificationData>;
  creation: Section<CreationData>;
  market: Section<MarketData>;
};

export type AlertSeverity = "high" | "medium" | "info";
export type AlertCode =
  | "no_code"
  | "scam_flag"
  | "unverified"
  | "new_contract"
  | "no_pairs"
  | "low_liquidity"
  | "upgradeable_proxy"
  | "owner_active"
  | "abi_privileged";
export type TokenAlert = { code: AlertCode; severity: AlertSeverity };

export type TokenReport = { facts: TokenFacts; alerts: TokenAlert[]; checkedAt: string };

export const ok = <T>(data: T): Section<T> => ({ status: "ok", data });
export const unknown = <T = never>(reason: UnknownReason): Section<T> => ({ status: "unknown", reason });
