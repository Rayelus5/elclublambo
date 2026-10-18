import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type GetLogsArgs = { address: string; event: { name: string }; args: Record<string, string>; fromBlock: bigint; toBlock: bigint };
type FakeLog = { address: string; event: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: string; logIndex: number };

let latest = 10_000n;
let logs: FakeLog[] = [];
const getLogs = vi.fn(async (a: GetLogsArgs) =>
  logs.filter(
    (l) =>
      l.address.toLowerCase() === a.address.toLowerCase() &&
      l.event === a.event.name &&
      l.blockNumber >= a.fromBlock &&
      l.blockNumber <= a.toBlock &&
      Object.entries(a.args ?? {}).every(([k, v]) => String(l.args[k]).toLowerCase() === v.toLowerCase()),
  ),
);
const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, timestamp: 1_800_000_000n + blockNumber }));
const getBlockNumber = vi.fn(async () => latest);
vi.mock("@/lib/payments/chain-client", () => ({
  chainClient: () => ({
    getLogs: (a: GetLogsArgs) => getLogs(a),
    getBlock: (a: { blockNumber: bigint }) => getBlock(a),
    getBlockNumber: () => getBlockNumber(),
  }),
}));

let cursor: string | number | null = 5000;
let safe: string | null;
let snapshots: { block_number: string; eth_wei: string; taken_at: string }[] = [];
let ethCursor: string | null = null;
let setCursorError: unknown = null;
const rpc = vi.fn(async (...[name]: [string, unknown?]) => {
  if (name === "dao_scan_from") return { data: cursor, error: null };
  if (name === "dao_eth_scan_from") return { data: ethCursor, error: null };
  if (name === "record_safe_operations") return { data: { inserted: 2, alerts: 1 }, error: null };
  if (name === "set_dao_eth_cursor") return { data: null, error: setCursorError };
  return { data: null, error: { message: "unexpected" } };
});
/** dao_nav_snapshots honours gte / lt on block_number, order (asc/desc) and limit, like PostgREST. */
function builder(table: string) {
  const b: Record<string, unknown> = {};
  let rows = [...snapshots];
  let lim = Infinity;
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.gte = (_c: string, v: string | bigint) => ((rows = rows.filter((r) => BigInt(r.block_number) >= BigInt(v))), b);
  b.lt = (_c: string, v: string | bigint) => ((rows = rows.filter((r) => BigInt(r.block_number) < BigInt(v))), b);
  b.order = (_c: string, o?: { ascending?: boolean }) => {
    rows.sort((x, y) => (BigInt(x.block_number) < BigInt(y.block_number) ? -1 : 1));
    if (o?.ascending === false) rows.reverse();
    return b;
  };
  b.limit = (n: number) => ((lim = n), b);
  b.maybeSingle = async () => ({
    data: table === "chain_config" ? { safe_address: safe } : (rows.slice(0, lim)[0] ?? null),
    error: null,
  });
  b.then = (res: (v: unknown) => unknown) => res({ data: table === "dao_nav_snapshots" ? rows.slice(0, lim) : [], error: null });
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t), rpc: (n: string, a?: unknown) => rpc(n, a) }) }));

import { NETWORKS } from "@/lib/economy/networks";
import { scanSafeOperations } from "@/lib/treasury/scan";

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const OTHER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const WETH = "0x2222222222222222222222222222222222222222";
const USDC = NETWORKS[59141].usdc;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const iso = (block: bigint) => new Date(Number(1_800_000_000n + block) * 1000).toISOString();
const ETH = 10n ** 18n;

const recorded = () => {
  const c = rpc.mock.calls.filter((x) => x[0] === "record_safe_operations");
  expect(c).toHaveLength(1);
  return c[0]![1] as { p_chain: number; p_safe: string; p_ops: Record<string, unknown>[]; p_to_block: string };
};
const transferCalls = () => getLogs.mock.calls.map((c) => c[0]).filter((a) => a.event.name === "Transfer");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WETH_ADDRESS_59141", WETH);
  vi.stubEnv("TIP_CONFIRMATIONS", "3");
  latest = 10_000n;
  cursor = 5000;
  safe = SAFE;
  logs = [];
  snapshots = [];
  ethCursor = null;
  setCursorError = null;
});
const cursorSets = () => rpc.mock.calls.filter((x) => x[0] === "set_dao_eth_cursor").map((x) => x[1]);
afterEach(() => vi.unstubAllEnvs());

describe("scanSafeOperations: cursor", () => {
  it("first scan of a chain: starts at latest − confirmations, inserts nothing and records the block", async () => {
    cursor = null;
    logs = [{ address: USDC, event: "Transfer", args: { from: OTHER, to: SAFE, value: 5n }, blockNumber: 9000n, transactionHash: hash(1), logIndex: 0 }];
    expect(await scanSafeOperations(59141)).toEqual({ inserted: 2, alerts: 1 });
    expect(getLogs).not.toHaveBeenCalled();
    expect(recorded()).toEqual({ p_chain: 59141, p_safe: SAFE, p_ops: [], p_to_block: "9997" });
  });

  it("scans from the block after the cursor up to latest − confirmations in chunks of at most 2000 blocks", async () => {
    await scanSafeOperations(59141);
    const ranges = [...new Set(transferCalls().map((a) => `${a.fromBlock}-${a.toBlock}`))];
    expect(ranges).toEqual(["5001-7000", "7001-9000", "9001-9997"]);
    // USDC and WETH, both directions, every chunk
    const kinds = new Set(transferCalls().map((a) => `${a.address.toLowerCase()} ${JSON.stringify(a.args).toLowerCase()}`));
    expect(kinds).toEqual(
      new Set([
        `${USDC.toLowerCase()} {"from":"${SAFE}"}`,
        `${USDC.toLowerCase()} {"to":"${SAFE}"}`,
        `${WETH} {"from":"${SAFE}"}`,
        `${WETH} {"to":"${SAFE}"}`,
      ]),
    );
    expect(recorded().p_to_block).toBe("9997");
  });

  it("caps one run at 10 chunks: the cursor advances only over what was scanned", async () => {
    cursor = 0;
    latest = 100_000n;
    await scanSafeOperations(59141);
    expect(recorded().p_to_block).toBe("20000");
    expect(Math.max(...transferCalls().map((a) => Number(a.toBlock)))).toBe(20000);
  });

  it("a cursor at the tip fetches no logs and keeps the cursor", async () => {
    cursor = "9997";
    await scanSafeOperations(59141);
    expect(transferCalls()).toHaveLength(0);
    expect(recorded()).toMatchObject({ p_ops: [], p_to_block: "9997" });
  });

  it("null when the Safe is not configured, without reading the chain", async () => {
    safe = null;
    expect(await scanSafeOperations(59141)).toBeNull();
    expect(getBlockNumber).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a log read failure records nothing (the cursor does not move past unscanned blocks)", async () => {
    getLogs.mockRejectedValueOnce(new Error("rpc down"));
    await expect(scanSafeOperations(59141)).rejects.toThrow("rpc down");
    expect(rpc).not.toHaveBeenCalledWith("record_safe_operations", expect.anything());
  });
});

describe("scanSafeOperations: mapping", () => {
  it("maps direction, counterparty, amount and the block time of each Transfer", async () => {
    logs = [
      { address: USDC, event: "Transfer", args: { from: OTHER, to: SAFE, value: 1_000_000n }, blockNumber: 5005n, transactionHash: hash(1), logIndex: 3 },
      { address: WETH, event: "Transfer", args: { from: SAFE, to: OTHER, value: 2n * ETH }, blockNumber: 8000n, transactionHash: hash(2), logIndex: 0 },
      { address: USDC, event: "Transfer", args: { from: OTHER, to: OTHER, value: 9n }, blockNumber: 5006n, transactionHash: hash(3), logIndex: 0 },
    ];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([
      { txHash: hash(1), logIndex: 3, asset: "USDC", direction: "in", amount: "1000000", counterparty: OTHER, blockNumber: "5005", occurredAt: iso(5005n) },
      { txHash: hash(2), logIndex: 0, asset: "WETH", direction: "out", amount: "2000000000000000000", counterparty: OTHER, blockNumber: "8000", occurredAt: iso(8000n) },
    ]);
    expect(getBlock).toHaveBeenCalledTimes(2);
  });

  it("ignores a Safe-to-Safe transfer (not an operation)", async () => {
    logs = [{ address: USDC, event: "Transfer", args: { from: SAFE, to: SAFE, value: 7n }, blockNumber: 6000n, transactionHash: hash(4), logIndex: 0 }];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([]);
  });

  it("skips WETH when the chain has none", async () => {
    vi.stubEnv("WETH_ADDRESS_59141", "");
    const orig = NETWORKS[59141].weth;
    (NETWORKS[59141] as { weth: string | null }).weth = null;
    try {
      await scanSafeOperations(59141);
      expect(transferCalls().every((a) => a.address === USDC)).toBe(true);
    } finally {
      (NETWORKS[59141] as { weth: string | null }).weth = orig;
    }
  });
});

describe("scanSafeOperations: native ETH between the last two snapshots", () => {
  const snap = (block: bigint, eth: bigint, at = iso(block)) => ({ block_number: String(block), eth_wei: eth.toString(), taken_at: at });

  it("adds an ETH inflow for a native increase no logged WETH unwrap explains", async () => {
    snapshots = [snap(9999n, 3n * ETH, "2026-10-18T13:00:00.000Z"), snap(9000n, 1n * ETH)];
    logs = [{ address: WETH, event: "Withdrawal", args: { src: SAFE, wad: ETH / 2n }, blockNumber: 9500n, transactionHash: hash(9), logIndex: 1 }];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([
      { txHash: null, logIndex: null, asset: "ETH", direction: "in", amount: (ETH + ETH / 2n).toString(), counterparty: null, blockNumber: "9999", occurredAt: "2026-10-18T13:00:00.000Z" },
    ]);
    const window = getLogs.mock.calls.map((c) => c[0]).filter((a) => a.event.name === "Withdrawal");
    expect(window).toEqual([expect.objectContaining({ address: WETH, args: { src: SAFE }, fromBlock: 9001n, toBlock: 9999n })]);
  });

  it("adds an ETH outflow for a native decrease (wraps into WETH are explained)", async () => {
    snapshots = [snap(9999n, 1n * ETH), snap(9000n, 4n * ETH)];
    logs = [{ address: WETH, event: "Deposit", args: { dst: SAFE, wad: ETH }, blockNumber: 9100n, transactionHash: hash(8), logIndex: 0 }];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([expect.objectContaining({ asset: "ETH", direction: "out", amount: (2n * ETH).toString(), txHash: null })]);
  });

  it("no ETH op when the change is fully explained by WETH unwraps, or there is no change", async () => {
    snapshots = [snap(9999n, 2n * ETH), snap(9000n, 1n * ETH)];
    logs = [{ address: WETH, event: "Withdrawal", args: { src: SAFE, wad: ETH }, blockNumber: 9500n, transactionHash: hash(9), logIndex: 1 }];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([]);
    rpc.mockClear();
    snapshots = [snap(9999n, ETH), snap(9000n, ETH)];
    logs = [];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([]);
  });

  it("no ETH op with fewer than two snapshots, or when the pair is older than the cursor", async () => {
    snapshots = [snap(9999n, 3n * ETH)];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([]);
    rpc.mockClear();
    snapshots = [snap(4000n, 3n * ETH), snap(3000n, ETH)];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([]);
  });

  it("F4a-R6: diffs EVERY pair after the ETH cursor (an outflow in the first of three is recorded) and advances it", async () => {
    ethCursor = "1000";
    snapshots = [snap(1000n, 2n * ETH), snap(2000n, ETH), snap(3000n, ETH), snap(4000n, ETH + ETH / 2n), snap(500n, 9n * ETH)];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([
      expect.objectContaining({ asset: "ETH", direction: "out", amount: ETH.toString(), blockNumber: "2000", txHash: null }),
      expect.objectContaining({ asset: "ETH", direction: "in", amount: (ETH / 2n).toString(), blockNumber: "4000" }),
    ]);
    const windows = getLogs.mock.calls.map((c) => c[0]).filter((a) => a.event.name === "Withdrawal").map((a) => `${a.fromBlock}-${a.toBlock}`);
    expect(windows).toEqual(["1001-2000", "2001-3000", "3001-4000"]);
    expect(cursorSets()).toEqual([{ p_chain: 59141, p_safe: SAFE, p_block: "4000" }]);
    // the cursor moves only after the ops were stored
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names.indexOf("set_dao_eth_cursor")).toBeGreaterThan(names.indexOf("record_safe_operations"));
  });

  it("caps a run at 24 pairs and resumes from there next run, skipping none", async () => {
    ethCursor = "0";
    snapshots = Array.from({ length: 30 }, (_, i) => snap(BigInt(i * 1000), BigInt(i % 2) * ETH));
    await scanSafeOperations(59141);
    expect(recorded().p_ops.map((o) => o.blockNumber)).toEqual(Array.from({ length: 24 }, (_, i) => String((i + 1) * 1000)));
    expect(cursorSets()).toEqual([{ p_chain: 59141, p_safe: SAFE, p_block: "24000" }]);

    rpc.mockClear();
    ethCursor = "24000";
    await scanSafeOperations(59141);
    expect(recorded().p_ops.map((o) => o.blockNumber)).toEqual(["25000", "26000", "27000", "28000", "29000"]);
    expect(cursorSets()).toEqual([{ p_chain: 59141, p_safe: SAFE, p_block: "29000" }]);
  });

  it("first scan of a chain: the ETH cursor starts at the newest snapshot (no backfill)", async () => {
    cursor = null;
    snapshots = [snap(9000n, ETH), snap(9999n, 5n * ETH)];
    await scanSafeOperations(59141);
    expect(recorded().p_ops).toEqual([]);
    expect(cursorSets()).toEqual([{ p_chain: 59141, p_safe: SAFE, p_block: "9999" }]);
  });

  it("no snapshots: the ETH cursor is left alone", async () => {
    await scanSafeOperations(59141);
    expect(cursorSets()).toEqual([]);
  });

  it("a failing cursor update is reported (the next run recomputes the same pairs; SQL dedupes them)", async () => {
    ethCursor = "1000";
    snapshots = [snap(1000n, 2n * ETH), snap(2000n, ETH)];
    setCursorError = { message: "boom" };
    await expect(scanSafeOperations(59141)).rejects.toThrow(/set_dao_eth_cursor/);
    expect(recorded().p_ops).toHaveLength(1);
  });
});
