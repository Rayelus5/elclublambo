import { parseAbiItem, type PublicClient } from "viem";

type Address = `0x${string}`;
type Hash = `0x${string}`;

/** C1: the scan covers at most this many blocks after the send (~27 h on Base, ~3.5 h on Arbitrum)… */
export const SCAN_WINDOW = 50_000n;
/** …asked in chunks of this size, which public RPCs accept for eth_getLogs. */
export const SCAN_CHUNK = 10_000n;

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

type LogClient = Pick<PublicClient, "getBlockNumber" | "getLogs">;

/**
 * C1: a USDC `Transfer(from, to, value == amount)` mined from `fromBlock` (the block read just before signing) for at
 * most SCAN_WINDOW blocks, or within the last SCAN_WINDOW blocks when the block is unknown. Returns its tx hash, or null
 * when there is none. Hashes in `exclude` (other lines' transfers) never match. An RPC error is thrown: the caller then
 * marks the line `scan_failed`, never signable.
 *
 * The earliest match wins. An identical transfer (same wallet, recipient and amount) made outside this tool after the
 * attempt also matches and counts as sent: the safe side, and the UI says so (finding 9).
 */
export async function findTransfer(
  client: LogClient,
  { usdc, from, to, amount, fromBlock, exclude }: { usdc: Address; from: Address; to: Address; amount: bigint; fromBlock?: bigint; exclude?: ReadonlySet<string> },
): Promise<Hash | null> {
  const latest = await client.getBlockNumber();
  const start = fromBlock ?? (latest > SCAN_WINDOW ? latest - SCAN_WINDOW : 0n);
  const end = start + SCAN_WINDOW < latest ? start + SCAN_WINDOW : latest;
  for (let a = start; a <= end; a += SCAN_CHUNK) {
    const b = a + SCAN_CHUNK - 1n < end ? a + SCAN_CHUNK - 1n : end;
    const logs = await client.getLogs({ address: usdc, event: TRANSFER, args: { from, to }, fromBlock: a, toBlock: b });
    const hit = logs.find((l) => l.args.value === amount && l.transactionHash !== null && !exclude?.has(l.transactionHash));
    if (hit?.transactionHash) return hit.transactionHash;
  }
  return null;
}
