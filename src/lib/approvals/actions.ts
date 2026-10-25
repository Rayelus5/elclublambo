"use server";

import { headers } from "next/headers";
import { isAddress } from "viem";
import { chainForKey, type NetworkKey } from "@/lib/economy/networks";
import { hitIpRateLimit } from "@/lib/rate-limit/ip";
import { checkAllowance } from "./read";
import type { ApprovalRow } from "./types";

export type CheckAllowanceError = "invalid_input" | "rate_limited" | "not_a_token" | "rpc_unavailable";

const NETWORKS: ReadonlySet<string> = new Set<NetworkKey>(["base", "arbitrum"]);

/**
 * One (token, spender) allowance of `owner` on this build's Base or Arbitrum: the manual check and the re-check after a
 * revoke (P6-R2d). No session: allowances are public. A malformed input is refused before the limiter; then one hit
 * of `approvals_scan` (P6-R2e) — a limiter "error" lets the check through, as the checker page does. `row: null` is an
 * allowance of 0.
 */
export async function checkAllowanceAction(input: {
  chain: NetworkKey;
  owner: string;
  token: string;
  spender: string;
}): Promise<{ ok: true; row: ApprovalRow | null } | { ok: false; error: CheckAllowanceError }> {
  const { chain, owner, token, spender } = input ?? {};
  if (typeof chain !== "string" || !NETWORKS.has(chain)) return { ok: false, error: "invalid_input" };
  for (const a of [owner, token, spender]) {
    if (typeof a !== "string" || !isAddress(a, { strict: false })) return { ok: false, error: "invalid_input" };
  }
  if ((await hitIpRateLimit("approvals_scan", await headers())) === "rate_limited") return { ok: false, error: "rate_limited" };
  const res = await checkAllowance(chainForKey(chain), owner as `0x${string}`, token as `0x${string}`, spender as `0x${string}`);
  if ("error" in res) return { ok: false, error: res.error };
  return { ok: true, row: "spender" in res ? res : null };
}
