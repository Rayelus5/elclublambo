import "server-only";
import { parseAbiItem, type Address } from "viem";
import type { ChainId } from "@/lib/economy/networks";
import { chainClient } from "@/lib/payments/chain-client";
import { defaultConfirmations } from "@/lib/payments/verify";
import { createAdminClient } from "@/lib/supabase/admin";
import { safeAddressOf } from "@/lib/treasury/snapshot";
import { addressesFor } from "@/lib/treasury/valuation";

/** One row for record_safe_operations: every integer as text, timestamps ISO. */
export type SafeOperation = {
  txHash: string | null;
  logIndex: number | null;
  asset: "USDC" | "WETH" | "ETH";
  direction: "in" | "out";
  amount: string;
  counterparty: string | null;
  blockNumber: string;
  occurredAt: string;
};

const CHUNK = 2000n;
/** At most this many chunks per run (20 000 blocks): a long outage catches up over several runs. */
const MAX_CHUNKS = 10n;

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
// WETH9 wraps and unwraps emit Deposit / Withdrawal, not Transfer: they explain native-ETH changes.
const DEPOSIT = parseAbiItem("event Deposit(address indexed dst, uint256 wad)");
const WITHDRAWAL = parseAbiItem("event Withdrawal(address indexed src, uint256 wad)");

type Client = ReturnType<typeof chainClient>;
type SnapshotRow = { block_number: string; eth_wei: string; taken_at: string };

/** [from, to] split into chunks of at most CHUNK blocks. */
function chunks(from: bigint, to: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let a = from; a <= to; a += CHUNK) out.push([a, a + CHUNK - 1n < to ? a + CHUNK - 1n : to]);
  return out;
}

/**
 * Scans the Safe's USDC and WETH Transfer logs since the last scanned block (up to latest − TIP_CONFIRMATIONS, at most
 * 20 000 blocks per run) and stores them with record_safe_operations, which links donations, alerts treasurers on
 * outflows and advances the cursor. A native-ETH change between the last two snapshots that WETH wraps/unwraps do not
 * explain becomes an ETH operation without hash. The first scan of a chain only sets the cursor (no backfill).
 * Null when the Safe is unset. Read errors throw before anything is recorded, so no block is ever skipped.
 */
export async function scanSafeOperations(chain: ChainId): Promise<{ inserted: number; alerts: number } | null> {
  const db = createAdminClient();
  const safe = await safeAddressOf(db, chain);
  if (!safe) return null;
  const client = chainClient(chain);

  const latest = await client.getBlockNumber();
  const confirmations = BigInt(defaultConfirmations());
  const tip = latest > confirmations ? latest - confirmations : 0n;

  const { data: cursorRaw, error: cursorError } = await db.rpc("dao_scan_from", { p_chain: chain });
  if (cursorError) throw new Error(`dao_scan_from failed: ${cursorError.message}`);

  let toBlock = tip;
  const ops: SafeOperation[] = [];
  if (cursorRaw !== null && cursorRaw !== undefined) {
    const cursor = BigInt(String(cursorRaw));
    const start = cursor + 1n;
    const cap = start + CHUNK * MAX_CHUNKS - 1n;
    toBlock = tip < cap ? tip : cap;
    if (toBlock < cursor) toBlock = cursor;

    const { usdc, weth } = addressesFor(chain);
    const tokens: ["USDC" | "WETH", Address][] = [["USDC", usdc]];
    if (weth) tokens.push(["WETH", weth]);
    if (start <= toBlock) ops.push(...(await transferOps(client, safe, tokens, start, toBlock)));

    const eth = await nativeEthOp(db, client, chain, safe, weth, start);
    if (eth) ops.push(eth);
  }

  const { data, error } = await db.rpc("record_safe_operations", { p_chain: chain, p_ops: ops, p_to_block: toBlock.toString() });
  if (error) throw new Error(`record_safe_operations failed: ${error.message}`);
  const r = (data ?? {}) as { inserted?: unknown; alerts?: unknown };
  return { inserted: Number(r.inserted ?? 0), alerts: Number(r.alerts ?? 0) };
}

async function transferOps(client: Client, safe: Address, tokens: ["USDC" | "WETH", Address][], from: bigint, to: bigint): Promise<SafeOperation[]> {
  const safeLc = safe.toLowerCase();
  const times = new Map<bigint, string>();
  const occurredAt = async (block: bigint) => {
    if (!times.has(block)) {
      const b = await client.getBlock({ blockNumber: block });
      times.set(block, new Date(Number(b.timestamp) * 1000).toISOString());
    }
    return times.get(block)!;
  };

  const ops: SafeOperation[] = [];
  for (const [fromBlock, toBlock] of chunks(from, to)) {
    for (const [asset, address] of tokens) {
      const [outs, ins] = await Promise.all([
        client.getLogs({ address, event: TRANSFER, args: { from: safe }, fromBlock, toBlock }),
        client.getLogs({ address, event: TRANSFER, args: { to: safe }, fromBlock, toBlock }),
      ]);
      for (const log of [...outs, ...ins]) {
        const src = String(log.args.from ?? "").toLowerCase();
        const dst = String(log.args.to ?? "").toLowerCase();
        const out = src === safeLc;
        if (out === (dst === safeLc)) continue; // Safe to Safe (or neither): not an operation
        if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) continue; // pending log
        ops.push({
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          asset,
          direction: out ? "out" : "in",
          amount: (log.args.value ?? 0n).toString(),
          counterparty: out ? dst : src,
          blockNumber: log.blockNumber.toString(),
          occurredAt: await occurredAt(log.blockNumber),
        });
      }
    }
  }
  return ops.filter((o) => o.amount !== "0");
}

/**
 * The native-ETH change between the last two snapshots minus what WETH unwraps (+) and wraps (−) in that window explain.
 * Only for a pair not covered by an earlier scan (the newer snapshot is at or after `start`); the SQL keeps one ETH op
 * per block, so a recomputed pair is not stored twice.
 */
async function nativeEthOp(
  db: ReturnType<typeof createAdminClient>,
  client: Client,
  chain: ChainId,
  safe: Address,
  weth: Address | null,
  start: bigint,
): Promise<SafeOperation | null> {
  const { data, error } = await db
    .from("dao_nav_snapshots")
    .select("block_number:block_number::text, eth_wei:eth_wei::text, taken_at")
    .eq("chain_id", chain)
    .order("taken_at", { ascending: false })
    .limit(2);
  if (error) throw new Error(`dao_nav_snapshots read failed: ${error.message}`);
  const [last, prev] = (data ?? []) as SnapshotRow[];
  if (!last || !prev) return null;
  const lastBlock = BigInt(last.block_number);
  const prevBlock = BigInt(prev.block_number);
  if (lastBlock < start || lastBlock <= prevBlock) return null;

  let explained = 0n;
  if (weth) {
    for (const [fromBlock, toBlock] of chunks(prevBlock + 1n, lastBlock)) {
      const [unwraps, wraps] = await Promise.all([
        client.getLogs({ address: weth, event: WITHDRAWAL, args: { src: safe }, fromBlock, toBlock }),
        client.getLogs({ address: weth, event: DEPOSIT, args: { dst: safe }, fromBlock, toBlock }),
      ]);
      for (const l of unwraps) explained += l.args.wad ?? 0n;
      for (const l of wraps) explained -= l.args.wad ?? 0n;
    }
  }

  const residual = BigInt(last.eth_wei) - BigInt(prev.eth_wei) - explained;
  if (residual === 0n) return null;
  return {
    txHash: null,
    logIndex: null,
    asset: "ETH",
    direction: residual > 0n ? "in" : "out",
    amount: (residual > 0n ? residual : -residual).toString(),
    counterparty: null,
    blockNumber: lastBlock.toString(),
    occurredAt: new Date(last.taken_at).toISOString(),
  };
}
