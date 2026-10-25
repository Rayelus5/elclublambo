import "server-only";
import { getAddress, isAddress, keccak256, pad, toBytes } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { checkerSources, getJson } from "@/lib/checker/token/sources";
import type { ApprovalUnavailableReason } from "./types";

// Discovery of an owner's ERC-20 approvals through Blockscout's RPC API `getLogs` (P6-R2): the only keyless endpoint
// that filters logs by topic without a contract address. Sources (2026-10-25): docs.blockscout.com/devs/apis/rpc/logs
// and apps/block_scout_web/lib/block_scout_web/{controllers/api/rpc/logs_controller.ex,views/api/rpc/logs_view.ex}.
// Same host and testnet-only overrides as the checker (checkerSources), same 5 s timeout and challenge detection
// (getJson). It only finds candidate (token, spender) pairs; the live allowance is read on our RPC (read.ts).

/** keccak256("Approval(address,address,uint256)"): ERC-20's and ERC-721's Approval share it (ERC-721 has 4 topics). */
export const APPROVAL_TOPIC = keccak256(toBytes("Approval(address,address,uint256)"));
/** Blockscout's getLogs returns at most this many logs: reaching it means the list may be incomplete. */
export const BLOCKSCOUT_LOG_CAP = 1000;

export type ApprovalPair = { token: `0x${string}`; spender: `0x${string}` };
export type DiscoveredPairs =
  | { status: "ok"; pairs: ApprovalPair[]; partial: boolean }
  | { status: "unavailable"; reason: ApprovalUnavailableReason };

const TOPIC_RE = /^0x[0-9a-fA-F]{64}$/;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const hexNum = (v: unknown): bigint => {
  try {
    return typeof v === "string" && v !== "" ? BigInt(v) : -1n;
  } catch {
    return -1n;
  }
};

function getLogsUrl(base: string, owner: `0x${string}`): string {
  const q = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    fromBlock: "0",
    toBlock: "latest",
    topic0: APPROVAL_TOPIC,
    topic1: pad(owner.toLowerCase() as `0x${string}`, { size: 32 }),
    topic0_1_opr: "and",
  });
  return `${base}/api?${q.toString()}`;
}

type Candidate = ApprovalPair & { block: bigint; index: bigint };

/**
 * One log as a candidate pair, or null. Blockscout always sends four topic slots padded with null (logs_view.ex); a
 * node's eth_getLogs sends only the present ones. An ERC-20 Approval has exactly three non-null topics.
 */
function candidate(log: unknown, ownerTopic: string): Candidate | null {
  if (!isObj(log) || !Array.isArray(log.topics) || typeof log.address !== "string" || !isAddress(log.address, { strict: false })) return null;
  const topics = log.topics.filter((t) => t !== null);
  if (topics.length !== 3 || log.topics.slice(0, 3).some((t) => t === null)) return null;
  const [t0, t1, t2] = topics as unknown[];
  if (typeof t0 !== "string" || typeof t1 !== "string" || typeof t2 !== "string" || ![t0, t1, t2].every((t) => TOPIC_RE.test(t))) return null;
  if (t0.toLowerCase() !== APPROVAL_TOPIC || t1.toLowerCase() !== ownerTopic) return null;
  // An address topic is 12 zero bytes + 20; anything else is not a well-formed spender.
  if (!/^0x0{24}/i.test(t2)) return null;
  return {
    token: getAddress(log.address),
    spender: getAddress(`0x${t2.slice(-40)}`),
    block: hexNum(log.blockNumber),
    index: hexNum(log.logIndex),
  };
}

const reasonOf = (r: string): ApprovalUnavailableReason =>
  r === "blocked" || r === "timeout" || r === "rate_limited" ? r : "error";

/**
 * The (token, spender) pairs `owner` ever approved on `chain`, newest first, without duplicates. Never throws: any
 * failure is `unavailable` with its reason (never an empty list), and a capped answer is `partial`.
 */
export async function discoverApprovalPairs(
  chain: ChainId,
  owner: `0x${string}`,
  env: Record<string, string | undefined> = process.env,
): Promise<DiscoveredPairs> {
  try {
    const r = await getJson(getLogsUrl(checkerSources(chain, env).blockscout, owner));
    if (r.kind === "fail") return { status: "unavailable", reason: reasonOf(r.reason) };
    if (r.kind === "not_found" || !isObj(r.json)) return { status: "unavailable", reason: "error" };
    const { status, message, result } = r.json;
    if (status === "0" && message === "No logs found") return { status: "ok", pairs: [], partial: false };
    if (status !== "1" || !Array.isArray(result)) return { status: "unavailable", reason: "error" };

    const ownerTopic = pad(owner.toLowerCase() as `0x${string}`, { size: 32 });
    const found = result.map((l) => candidate(l, ownerTopic)).filter((c): c is Candidate => c !== null);
    found.sort((a, b) => (a.block === b.block ? (a.index < b.index ? 1 : a.index > b.index ? -1 : 0) : a.block < b.block ? 1 : -1));
    const seen = new Set<string>();
    const pairs: ApprovalPair[] = [];
    for (const c of found) {
      const k = `${c.token}:${c.spender}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pairs.push({ token: c.token, spender: c.spender });
    }
    return { status: "ok", pairs, partial: result.length >= BLOCKSCOUT_LOG_CAP };
  } catch {
    return { status: "unavailable", reason: "error" };
  }
}
