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

/** Snapshot pairs diffed per run (about a day of hourly snapshots). */
const ETH_PAIRS_PER_RUN = 24;

type Client = ReturnType<typeof chainClient>;
type Db = ReturnType<typeof createAdminClient>;
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
 * outflows and advances the cursor. A native-ETH change between two consecutive snapshots that WETH wraps/unwraps do
 * not explain becomes an ETH operation without hash (every pair after the ETH cursor, F4a-R6). The first scan of a
 * chain only sets the cursors (no backfill).
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
  let ethCursor: bigint | null = null;
  if (cursorRaw === null || cursorRaw === undefined) {
    // First scan: no backfill. The ETH diff starts at the newest snapshot.
    ethCursor = await newestSnapshotBlock(db, chain);
  } else {
    const cursor = BigInt(String(cursorRaw));
    const start = cursor + 1n;
    const cap = start + CHUNK * MAX_CHUNKS - 1n;
    toBlock = tip < cap ? tip : cap;
    if (toBlock < cursor) toBlock = cursor;

    const { usdc, weth } = addressesFor(chain);
    const tokens: ["USDC" | "WETH", Address][] = [["USDC", usdc]];
    if (weth) tokens.push(["WETH", weth]);
    if (start <= toBlock) ops.push(...(await transferOps(client, safe, tokens, start, toBlock)));

    const eth = await nativeEthOps(db, client, chain, safe, weth, start);
    ops.push(...eth.ops);
    ethCursor = eth.cursor;
  }

  const { data, error } = await db.rpc("record_safe_operations", { p_chain: chain, p_ops: ops, p_to_block: toBlock.toString() });
  if (error) throw new Error(`record_safe_operations failed: ${error.message}`);
  // Only after the ETH ops are stored. If this fails, the next run recomputes the same pairs and SQL dedupes them.
  if (ethCursor !== null) {
    const { error: cursorSetError } = await db.rpc("set_dao_eth_cursor", { p_chain: chain, p_block: ethCursor.toString() });
    if (cursorSetError) throw new Error(`set_dao_eth_cursor failed: ${cursorSetError.message}`);
  }
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

const SNAPSHOT_COLUMNS = "block_number:block_number::text, eth_wei:eth_wei::text, taken_at";

function snapshots(db: Db, chain: ChainId) {
  return db.from("dao_nav_snapshots").select(SNAPSHOT_COLUMNS).eq("chain_id", chain);
}

async function newestSnapshotBlock(db: Db, chain: ChainId): Promise<bigint | null> {
  const { data, error } = await snapshots(db, chain).order("block_number", { ascending: false }).limit(1).maybeSingle<SnapshotRow>();
  if (error) throw new Error(`dao_nav_snapshots read failed: ${error.message}`);
  return data ? BigInt(data.block_number) : null;
}

/**
 * Ruling F4a-R6: diffs EVERY consecutive snapshot pair after the ETH cursor (the last snapshot already diffed), at most
 * ETH_PAIRS_PER_RUN pairs per run so a long gap catches up over several runs without skipping one. Each pair gives at
 * most one ETH op, keyed by the later snapshot's block. Without an ETH cursor (a chain scanned before it existed, or
 * with no snapshot at its first scan) the baseline is the newest snapshot before the log scan's start, else the oldest
 * one. Returns the new ETH cursor (null: nothing to move).
 */
async function nativeEthOps(
  db: Db,
  client: Client,
  chain: ChainId,
  safe: Address,
  weth: Address | null,
  scanStart: bigint,
): Promise<{ ops: SafeOperation[]; cursor: bigint | null }> {
  const { data: fromRaw, error: fromError } = await db.rpc("dao_eth_scan_from", { p_chain: chain });
  if (fromError) throw new Error(`dao_eth_scan_from failed: ${fromError.message}`);

  let rows: SnapshotRow[];
  const read = async (q: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await q;
    if (error) throw new Error(`dao_nav_snapshots read failed: ${error.message}`);
    return (data ?? []) as SnapshotRow[];
  };
  if (fromRaw !== null && fromRaw !== undefined) {
    // the snapshot at the cursor is the baseline of the first pair
    rows = await read(snapshots(db, chain).gte("block_number", String(fromRaw)).order("block_number", { ascending: true }).limit(ETH_PAIRS_PER_RUN + 1));
  } else {
    const baseline = await read(snapshots(db, chain).lt("block_number", scanStart.toString()).order("block_number", { ascending: false }).limit(1));
    const rest = await read(
      snapshots(db, chain)
        .gte("block_number", scanStart.toString())
        .order("block_number", { ascending: true })
        .limit(ETH_PAIRS_PER_RUN + 1 - baseline.length),
    );
    rows = [...baseline, ...rest];
  }

  const ops: SafeOperation[] = [];
  for (let i = 1; i < rows.length; i++) {
    const op = await pairOp(client, safe, weth, rows[i - 1]!, rows[i]!);
    if (op) ops.push(op);
  }
  const last = rows.at(-1);
  return { ops, cursor: last ? BigInt(last.block_number) : null };
}

/** The native-ETH change of one snapshot pair minus what WETH unwraps (+) and wraps (−) inside (prev, last] explain. */
async function pairOp(client: Client, safe: Address, weth: Address | null, prev: SnapshotRow, last: SnapshotRow): Promise<SafeOperation | null> {
  const lastBlock = BigInt(last.block_number);
  const prevBlock = BigInt(prev.block_number);
  if (lastBlock <= prevBlock) return null;

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
