import "server-only";
import { erc20Abi, getAddress, type PublicClient } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { contractText, rpcFailure } from "@/lib/checker/token/sources";
import { safeError } from "@/lib/security/redact";
import { discoverApprovalPairs, type ApprovalPair } from "./discover";
import { spenderLabel } from "./spenders";
import { UNLIMITED_THRESHOLD, type ApprovalRow, type ApprovalScan, type SpenderKind } from "./types";

// The live allowance of each discovered pair (P6-R2b), read on the club's RPC in one Multicall3 batch
// (allowFailure: true): allowance(owner, spender) per pair, symbol()/decimals() per token, and getCode per spender.

/** At most this many pairs are read; more makes the list partial. */
export const MAX_PAIRS = 200;

/** The node did not answer an allowance: the scan is unavailable, not «no approvals». */
class RpcUnavailable extends Error {
  constructor(readonly reason: "timeout" | "rate_limited" | "error") {
    super(`rpc ${reason}`);
  }
}

type Outcome = { kind: "row"; row: ApprovalRow } | { kind: "zero" } | { kind: "revert" };
type Result = { status: "success"; result?: unknown } | { status: "failure"; error: Error };

const symbolOf = (r: Result | undefined) => (r?.status === "success" ? contractText(r.result) : null);
const decimalsOf = (r: Result | undefined) =>
  r?.status === "success" && typeof r.result === "number" && Number.isInteger(r.result) && r.result >= 0 && r.result <= 255 ? r.result : null;

/** One outcome per pair, in order. Throws RpcUnavailable when an allowance call failed in transport. */
async function readPairs(chain: ChainId, owner: `0x${string}`, pairs: ApprovalPair[], client: PublicClient): Promise<Outcome[]> {
  const norm = pairs.map((p) => ({ token: getAddress(p.token), spender: getAddress(p.spender) }));
  const tokens = [...new Set(norm.map((p) => p.token))];
  const spenders = [...new Set(norm.map((p) => p.spender))];

  // A spender whose code cannot be read stays an unknown contract (null): never shown as safer than it may be.
  const codes = Promise.all(
    spenders.map(async (address) => {
      try {
        const code = await client.getCode({ address });
        return [address, !code || code === "0x" ? "none" : "some"] as const;
      } catch {
        return [address, null] as const;
      }
    }),
  );
  const results = (await client.multicall({
    contracts: [
      ...norm.map((p) => ({ address: p.token, abi: erc20Abi, functionName: "allowance" as const, args: [owner, p.spender] as const })),
      ...tokens.flatMap((address) => [
        { address, abi: erc20Abi, functionName: "symbol" as const },
        { address, abi: erc20Abi, functionName: "decimals" as const },
      ]),
    ],
    allowFailure: true,
  })) as Result[];
  const codeOf = new Map(await codes);

  const meta = new Map(
    tokens.map((t, i) => [t, { symbol: symbolOf(results[norm.length + 2 * i]), decimals: decimalsOf(results[norm.length + 2 * i + 1]) }]),
  );
  return norm.map((p, i): Outcome => {
    const r = results[i];
    if (!r || r.status === "failure") {
      const reason = r ? rpcFailure(r.error) : "error";
      if (reason) throw new RpcUnavailable(reason === "timeout" || reason === "rate_limited" ? reason : "error");
      return { kind: "revert" };
    }
    if (typeof r.result !== "bigint") return { kind: "revert" };
    if (r.result <= 0n) return { kind: "zero" };
    const label = spenderLabel(chain, p.spender);
    const kind: SpenderKind = label ? "known" : codeOf.get(p.spender) === "none" ? "eoa" : "unknown_contract";
    const m = meta.get(p.token)!;
    return {
      kind: "row",
      row: {
        token: p.token,
        symbol: m.symbol,
        decimals: m.decimals,
        spender: p.spender,
        spenderLabel: label,
        spenderKind: kind,
        allowance: r.result.toString(),
        unlimited: r.result >= UNLIMITED_THRESHOLD,
      },
    };
  });
}

/**
 * The live allowances (> 0) of the first MAX_PAIRS pairs, in the given order; a reverting allowance is omitted.
 * Throws when the node did not answer (the caller reports the scan as unavailable).
 */
export async function readAllowances(
  chain: ChainId,
  owner: `0x${string}`,
  pairs: ApprovalPair[],
  client: PublicClient = chainClient(chain),
): Promise<{ rows: ApprovalRow[]; partial: boolean }> {
  const partial = pairs.length > MAX_PAIRS;
  if (pairs.length === 0) return { rows: [], partial };
  const outcomes = await readPairs(chain, owner, pairs.slice(0, MAX_PAIRS), client);
  return { rows: outcomes.flatMap((o) => (o.kind === "row" ? [o.row] : [])), partial };
}

/** Discover on Blockscout, then read the live allowances. Never throws. */
export async function scanApprovals(chain: ChainId, owner: `0x${string}`): Promise<ApprovalScan> {
  const found = await discoverApprovalPairs(chain, owner);
  if (found.status !== "ok") return found;
  try {
    const { rows, partial } = await readAllowances(chain, owner, found.pairs);
    return { status: "ok", rows, partial: partial || found.partial };
  } catch (e) {
    console.error("[approvals] allowance read failed", chain, safeError(e));
    return { status: "unavailable", reason: e instanceof RpcUnavailable ? e.reason : "error" };
  }
}

/**
 * One (token, spender) pair for the manual check and the re-check after a revoke: the row, `{ allowance: "0" }`,
 * `not_a_token` (no code, or `allowance` reverts) or `rpc_unavailable`.
 */
export async function checkAllowance(
  chain: ChainId,
  owner: `0x${string}`,
  token: `0x${string}`,
  spender: `0x${string}`,
  client: PublicClient = chainClient(chain),
): Promise<ApprovalRow | { allowance: "0" } | { error: "not_a_token" | "rpc_unavailable" }> {
  try {
    const code = await client.getCode({ address: getAddress(token) });
    if (!code || code === "0x") return { error: "not_a_token" };
    const [o] = await readPairs(chain, owner, [{ token, spender }], client);
    if (!o || o.kind === "revert") return { error: "not_a_token" };
    return o.kind === "zero" ? { allowance: "0" } : o.row;
  } catch (e) {
    console.error("[approvals] allowance check failed", chain, safeError(e));
    return { error: "rpc_unavailable" };
  }
}
