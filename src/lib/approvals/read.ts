import "server-only";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  erc20Abi,
  getAddress,
  isAddress,
  type PublicClient,
} from "viem";
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

/** The node did not answer (or answered nothing usable): the scan is unavailable, never «no approvals». */
class RpcUnavailable extends Error {
  constructor(readonly reason: "timeout" | "rate_limited" | "error") {
    super(`rpc ${reason}`);
  }
}

const unavailable = (e: unknown) => {
  const r = rpcFailure(e);
  return new RpcUnavailable(r === "timeout" || r === "rate_limited" ? r : "error");
};

/**
 * A per-call revert proven by a working batch: viem only builds a ContractFunctionExecutionError for `allowance` while
 * decoding aggregate3's own answer (call failed, or returned no data). A whole-batch failure (a JSON-RPC error body
 * such as -32603/-32000, aggregate3 answering 0x, a fallback transport's error, a timeout…) is copied as is into every
 * result of the chunk and is anything else: unavailable.
 */
const isCallRevert = (e: unknown) =>
  e instanceof ContractFunctionExecutionError &&
  e.functionName === "allowance" &&
  e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError) instanceof BaseError;

type Outcome = { kind: "row"; row: ApprovalRow } | { kind: "zero" } | { kind: "revert" };
type Result = { status: "success"; result?: unknown } | { status: "failure"; error: Error };

const symbolOf = (r: Result | undefined) => (r?.status === "success" ? contractText(r.result) : null);
const decimalsOf = (r: Result | undefined) =>
  r?.status === "success" && typeof r.result === "number" && Number.isInteger(r.result) && r.result >= 0 && r.result <= 255 ? r.result : null;

/** One outcome per pair, in order. Throws RpcUnavailable unless every failed allowance is a proven per-call revert. */
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
    if (!r) throw new RpcUnavailable("error");
    if (r.status === "failure") {
      if (!isCallRevert(r.error)) throw unavailable(r.error);
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
 * Throws when the node did not answer, and when every allowance reverted: that cannot be told apart from a broken
 * read, so it is reported as unavailable (the page falls back to the manual check) rather than as «no approvals».
 */
export async function readAllowances(
  chain: ChainId,
  owner: `0x${string}`,
  pairs: ApprovalPair[],
  client: PublicClient = chainClient(chain),
): Promise<{ rows: ApprovalRow[]; partial: boolean }> {
  const partial = pairs.length > MAX_PAIRS;
  if (pairs.length === 0) return { rows: [], partial };
  if (!isAddress(owner)) throw new TypeError("invalid owner");
  const outcomes = await readPairs(chain, owner, pairs.slice(0, MAX_PAIRS), client);
  if (outcomes.every((o) => o.kind === "revert")) throw new RpcUnavailable("error");
  return { rows: outcomes.flatMap((o) => (o.kind === "row" ? [o.row] : [])), partial };
}

/** Discover on Blockscout, then read the live allowances. Never throws. */
export async function scanApprovals(chain: ChainId, owner: `0x${string}`): Promise<ApprovalScan> {
  if (!isAddress(owner)) return { status: "unavailable", reason: "invalid_input" };
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
 * `invalid_input` (an argument is not an address), `not_a_token` (no code, or a working batch proves `allowance`
 * reverts) or `rpc_unavailable` (anything else, including any failure that cannot be told apart from a broken read).
 */
export async function checkAllowance(
  chain: ChainId,
  owner: `0x${string}`,
  token: `0x${string}`,
  spender: `0x${string}`,
  client: PublicClient = chainClient(chain),
): Promise<ApprovalRow | { allowance: "0" } | { error: "invalid_input" | "not_a_token" | "rpc_unavailable" }> {
  if (!isAddress(owner) || !isAddress(token) || !isAddress(spender)) return { error: "invalid_input" };
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
