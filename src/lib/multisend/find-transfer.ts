import { parseAbiItem, type PublicClient } from "viem";
import { NETWORKS, type ChainId } from "@/lib/economy/networks";

type Address = `0x${string}`;
type Hash = `0x${string}`;

/** eth_getLogs is asked in ranges of this many blocks, which public RPCs accept. */
export const SCAN_CHUNK = 10_000n;

/**
 * R3: the most blocks a scan covers after the block at send. That is about 27 h on Base (2 s blocks) and about 28 h on
 * Arbitrum (0.25 s blocks). Past it, the line is `scan_failed`: never tickable.
 */
export function scanCapFor(chain: ChainId): bigint {
  return NETWORKS[chain].key === "arbitrum" ? 400_000n : 50_000n;
}

/**
 * Nothing was scanned: the range from the block at send to latest is past the cap, or the node is behind the block at
 * send (latest < fromBlock: a lagging RPC). Either way the line is `scan_failed`, never «not found».
 */
export class ScanRangeError extends Error {
  constructor(reason: "past_cap" | "behind" = "past_cap") {
    super(reason === "past_cap" ? "scan range past the cap" : "node behind the block at send");
    this.name = "ScanRangeError";
  }
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

type LogClient = Pick<PublicClient, "getBlockNumber" | "getLogs">;

/**
 * C1/R3: a USDC `Transfer(from, to, value == amount)` mined from `fromBlock` (the block read right before the attempt)
 * up to latest, asked in SCAN_CHUNK ranges. Returns its tx hash, or null when there is none. No hash is ever skipped:
 * one atomic batch tx pays every line of the batch, and each line must find its own log in it (NEW-1). The parser sums
 * the lines of one address, so two lines never share a (recipient, amount) log. Throws ScanRangeError when latest is
 * more than `maxBlocks` past `fromBlock` or behind it, and passes RPC errors on: the caller then marks the line
 * `scan_failed`, never signable.
 *
 * The earliest match wins. An identical transfer (same wallet, recipient and amount) made outside this tool after the
 * attempt also matches and counts as sent: the safe side, and the UI says so (finding 9).
 */
export async function findTransfer(
  client: LogClient,
  {
    usdc,
    from,
    to,
    amount,
    fromBlock,
    maxBlocks,
  }: { usdc: Address; from: Address; to: Address; amount: bigint; fromBlock: bigint; maxBlocks: bigint },
): Promise<Hash | null> {
  const latest = await client.getBlockNumber();
  if (latest < fromBlock) throw new ScanRangeError("behind");
  if (latest - fromBlock > maxBlocks) throw new ScanRangeError("past_cap");
  for (let a = fromBlock; a <= latest; a += SCAN_CHUNK) {
    const b = a + SCAN_CHUNK - 1n < latest ? a + SCAN_CHUNK - 1n : latest;
    const logs = await client.getLogs({ address: usdc, event: TRANSFER, args: { from, to }, fromBlock: a, toBlock: b });
    const hit = logs.find((l) => l.args.value === amount && l.transactionHash !== null);
    if (hit?.transactionHash) return hit.transactionHash;
  }
  return null;
}
