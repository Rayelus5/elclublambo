import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type GetLogsArgs = { address: string; event: { name: string }; args: Record<string, string>; fromBlock: bigint; toBlock: bigint };
type FakeLog = { address: string; event: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: string; logIndex: number };

let latest = 10_000n;
let logs: FakeLog[] = [];
/** A lagging log index: getLogs omits every log above this block (and says nothing). */
let logsHead: bigint | null = null;
/** A non-archive node: balance reads below this block fail. */
let stateFrom: bigint | null = null;
/** Token balances before any log (lower-cased token address → units). */
let baseBalance: Record<string, bigint> = {};
const getLogs = vi.fn(async (a: GetLogsArgs) =>
  logs.filter(
    (l) =>
      (logsHead === null || l.blockNumber <= logsHead) &&
      l.address.toLowerCase() === a.address.toLowerCase() &&
      l.event === a.event.name &&
      l.blockNumber >= a.fromBlock &&
      l.blockNumber <= a.toBlock &&
      Object.entries(a.args ?? {}).every(([k, v]) => String(l.args[k]).toLowerCase() === v.toLowerCase()),
  ),
);
const getBlock = vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, timestamp: 1_800_000_000n + blockNumber }));
const getBlockNumber = vi.fn(async () => latest);
/** balanceOf(safe) at a block: the base plus every log up to it (Transfer in/out, WETH Deposit/Withdrawal), like a real token. */
const readContract = vi.fn(async (a: { address: string; functionName: string; args: [string]; blockNumber: bigint }) => {
  if (a.functionName !== "balanceOf") throw new Error(`unexpected ${a.functionName}`);
  if (stateFrom !== null && a.blockNumber < stateFrom) throw new Error("missing trie node");
  const token = a.address.toLowerCase();
  const who = a.args[0].toLowerCase();
  let bal = baseBalance[token] ?? 0n;
  for (const l of logs) {
    if (l.address.toLowerCase() !== token || l.blockNumber > a.blockNumber) continue;
    const arg = (k: string) => String(l.args[k] ?? "").toLowerCase();
    const v = (l.args.value ?? l.args.wad ?? 0n) as bigint;
    if (l.event === "Transfer") bal += (arg("to") === who ? v : 0n) - (arg("from") === who ? v : 0n);
    if (l.event === "Deposit" && arg("dst") === who) bal += v;
    if (l.event === "Withdrawal" && arg("src") === who) bal -= v;
  }
  return bal;
});
vi.mock("@/lib/legacy/linea-client", () => ({
  legacyChainClient: () => ({
    getLogs: (a: GetLogsArgs) => getLogs(a),
    getBlock: (a: { blockNumber: bigint }) => getBlock(a),
    getBlockNumber: () => getBlockNumber(),
    readContract: (a: never) => readContract(a),
  }),
}));

let cursor: string | number | null = 5000;
let safe: string | null;
let snapshots: { block_number: string; eth_wei: string; taken_at: string }[] = [];
let ethCursor: string | null = null;
let setCursorError: unknown = null;
/** dao_scan_balances: the balances stored at a block (null: none). */
let stored: { block: string; balances: Record<string, string> } | null = null;
const rpc = vi.fn(async (...[name]: [string, unknown?]) => {
  if (name === "dao_scan_from") return { data: cursor, error: null };
  if (name === "dao_scan_balances") return { data: stored, error: null };
  if (name === "dao_eth_scan_from") return { data: ethCursor, error: null };
  if (name === "record_safe_scan") return { data: { inserted: 2, alerts: 1 }, error: null };
  if (name === "record_scan_gap") return { data: 1, error: null };
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

import { LEGACY_NETWORKS as NETWORKS } from "@/lib/legacy/linea";
import { scanSafeOperations } from "@/lib/treasury/scan";

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const OTHER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const WETH = "0x2222222222222222222222222222222222222222";
const USDC = NETWORKS[59141].usdc;
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const iso = (block: bigint) => new Date(Number(1_800_000_000n + block) * 1000).toISOString();
const ETH = 10n ** 18n;

const recorded = () => {
  const c = rpc.mock.calls.filter((x) => x[0] === "record_safe_scan");
  expect(c).toHaveLength(1);
  return c[0]![1] as { p_chain: number; p_safe: string; p_ops: Record<string, unknown>[]; p_to_block: string; p_balances: Record<string, string> | null };
};
/** The scan range's chunks: the continuity check reads WETH Deposit/Withdrawal over them too (not a snapshot-pair window). */
const SCAN_RANGES = new Set(["5001-7000", "7001-9000", "9001-9997"]);
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
  stored = null;
  logsHead = null;
  stateFrom = null;
  baseBalance = {};
});
const cursorSets = () => rpc.mock.calls.filter((x) => x[0] === "set_dao_eth_cursor").map((x) => x[1]);
afterEach(() => vi.unstubAllEnvs());

describe("scanSafeOperations: cursor", () => {
  it("first scan of a chain: starts at latest − confirmations, inserts nothing and records the block", async () => {
    cursor = null;
    logs = [{ address: USDC, event: "Transfer", args: { from: OTHER, to: SAFE, value: 5n }, blockNumber: 9000n, transactionHash: hash(1), logIndex: 0 }];
    expect(await scanSafeOperations(59141)).toEqual({ inserted: 2, alerts: 1 });
    expect(getLogs).not.toHaveBeenCalled();
    expect(recorded()).toEqual({ p_chain: 59141, p_safe: SAFE, p_ops: [], p_to_block: "9997", p_balances: { USDC: "5", WETH: "0" } });
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
    expect(recorded()).toMatchObject({ p_ops: [], p_to_block: "9997", p_balances: null });
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
    expect(rpc).not.toHaveBeenCalledWith("record_safe_scan", expect.anything());
  });
});

describe("scanSafeOperations: balance continuity (F4-R1)", () => {
  const payout = (block: bigint, value = 400_000_000n) =>
    ({ address: USDC, event: "Transfer", args: { from: SAFE, to: OTHER, value }, blockNumber: block, transactionHash: hash(70), logIndex: 0 }) as FakeLog;

  it("a node whose logs stop short (getLogs [] over a real balance change) does not move the cursor: scan_gap", async () => {
    baseBalance = { [USDC.toLowerCase()]: 1_000_000_000n };
    logs = [payout(9_500n)];
    logsHead = 9_000n; // the log index trails: the payout at 9500 is never returned
    stored = { block: "5000", balances: { USDC: "1000000000", WETH: "0" } };
    expect(await scanSafeOperations(59141, { cron: true })).toBe("scan_gap");
    expect(rpc).not.toHaveBeenCalledWith("record_safe_scan", expect.anything());
    expect(rpc).toHaveBeenCalledWith("record_scan_gap", { p_chain: 59141 });
    expect(cursorSets()).toEqual([]);
  });

  it("R-M3: only the cron's runs count toward the stuck alert (a treasurer's catch-up scan does not)", async () => {
    baseBalance = { [USDC.toLowerCase()]: 1_000_000_000n };
    logs = [payout(9_500n)];
    logsHead = 9_000n;
    stored = { block: "5000", balances: { USDC: "1000000000", WETH: "0" } };
    expect(await scanSafeOperations(59141)).toBe("scan_gap");
    expect(rpc).not.toHaveBeenCalledWith("record_scan_gap", expect.anything());
  });

  it("R-M1: a stale stored baseline is re-read once at start − 1; when that explains the range the scan advances", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    baseBalance = { [USDC.toLowerCase()]: 1_000_000_000n };
    logs = [payout(9_500n)];
    stored = { block: "5000", balances: { USDC: "999", WETH: "0" } }; // wrong (a reorg, a node glitch…)
    expect(await scanSafeOperations(59141, { cron: true })).toEqual({ inserted: 2, alerts: 1 });
    expect(recorded().p_balances).toEqual({ USDC: "600000000", WETH: "0" });
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: USDC, blockNumber: 5_000n }));
    expect(rpc).not.toHaveBeenCalledWith("record_scan_gap", expect.anything());
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/stale stored baseline/), 59141, "USDC", expect.anything());
    err.mockRestore();
  });

  it("R-M4: USDC minted to the Safe and burned from it (Transfer from / to 0x0) reconcile: no false gap", async () => {
    const ZERO = "0x0000000000000000000000000000000000000000";
    baseBalance = { [USDC.toLowerCase()]: 10n };
    logs = [
      { address: USDC, event: "Transfer", args: { from: ZERO, to: SAFE, value: 500n }, blockNumber: 6_000n, transactionHash: hash(80), logIndex: 0 },
      { address: USDC, event: "Transfer", args: { from: SAFE, to: ZERO, value: 200n }, blockNumber: 7_000n, transactionHash: hash(81), logIndex: 0 },
    ];
    stored = { block: "5000", balances: { USDC: "10", WETH: "0" } };
    expect(await scanSafeOperations(59141)).toEqual({ inserted: 2, alerts: 1 });
    expect(recorded().p_balances).toEqual({ USDC: "310", WETH: "0" });
  });

  it("R-M4: a missed WETH Deposit (the wrap is not in the logs the node returned) is a gap", async () => {
    baseBalance = { [WETH]: 0n };
    logs = [{ address: WETH, event: "Deposit", args: { dst: SAFE, wad: ETH }, blockNumber: 9_500n, transactionHash: hash(82), logIndex: 0 }];
    logsHead = 9_000n;
    stored = { block: "5000", balances: { USDC: "0", WETH: "0" } };
    expect(await scanSafeOperations(59141)).toBe("scan_gap");
  });

  it("a toBlock the client does not have is a gap too", async () => {
    getBlock.mockRejectedValueOnce(new Error("block not found"));
    expect(await scanSafeOperations(59141)).toBe("scan_gap");
    expect(rpc).not.toHaveBeenCalledWith("record_safe_scan", expect.anything());
  });

  it("happy path: the logs explain every balance change and the balances at toBlock are stored with the cursor", async () => {
    baseBalance = { [USDC.toLowerCase()]: 1_000_000_000n, [WETH]: 5n * ETH };
    logs = [
      payout(9_500n),
      { address: USDC, event: "Transfer", args: { from: OTHER, to: SAFE, value: 3_000_000n }, blockNumber: 6_000n, transactionHash: hash(71), logIndex: 1 },
    ];
    stored = { block: "5000", balances: { USDC: "1000000000", WETH: (5n * ETH).toString() } };
    expect(await scanSafeOperations(59141)).toEqual({ inserted: 2, alerts: 1 });
    expect(recorded()).toMatchObject({ p_to_block: "9997", p_balances: { USDC: "603000000", WETH: (5n * ETH).toString() } });
    // the balances are read at toBlock from the same client, and toBlock was checked to exist
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: USDC, blockNumber: 9_997n }));
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 9_997n });
  });

  it("a WETH wrap (Deposit) and unwrap (Withdrawal) are counted: no false gap", async () => {
    baseBalance = { [WETH]: 2n * ETH };
    logs = [
      { address: WETH, event: "Deposit", args: { dst: SAFE, wad: 3n * ETH }, blockNumber: 6_000n, transactionHash: hash(72), logIndex: 0 },
      { address: WETH, event: "Withdrawal", args: { src: SAFE, wad: ETH }, blockNumber: 7_000n, transactionHash: hash(73), logIndex: 0 },
    ];
    stored = { block: "5000", balances: { USDC: "0", WETH: (2n * ETH).toString() } };
    expect(await scanSafeOperations(59141)).toEqual({ inserted: 2, alerts: 1 });
    expect(recorded().p_balances).toEqual({ USDC: "0", WETH: (4n * ETH).toString() });
  });

  it("without stored balances at the cursor it reads them at start − 1", async () => {
    baseBalance = { [USDC.toLowerCase()]: 1_000_000_000n };
    logs = [payout(9_500n)];
    logsHead = 9_000n;
    stored = { block: "4000", balances: { USDC: "1", WETH: "0" } }; // read at another block: not trusted
    expect(await scanSafeOperations(59141)).toBe("scan_gap");
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: USDC, blockNumber: 5_000n }));
  });

  it("a non-archive node that cannot read start − 1 falls back for this run and stores the balances at toBlock", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    baseBalance = { [USDC.toLowerCase()]: 7n };
    stateFrom = 9_000n;
    expect(await scanSafeOperations(59141)).toEqual({ inserted: 2, alerts: 1 });
    expect(recorded().p_balances).toEqual({ USDC: "7", WETH: "0" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a failing balance read at toBlock is a gap (the node may not have that block)", async () => {
    stored = { block: "5000", balances: { USDC: "0", WETH: "0" } };
    readContract.mockRejectedValueOnce(new Error("header not found"));
    expect(await scanSafeOperations(59141)).toBe("scan_gap");
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
    expect(getBlock).toHaveBeenCalledTimes(3); // two block times + the continuity check that toBlock exists
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
    const window = getLogs.mock.calls.map((c) => c[0]).filter((a) => a.event.name === "Withdrawal" && !SCAN_RANGES.has(`${a.fromBlock}-${a.toBlock}`));
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
    const windows = getLogs.mock.calls.map((c) => c[0]).filter((a) => a.event.name === "Withdrawal" && !SCAN_RANGES.has(`${a.fromBlock}-${a.toBlock}`)).map((a) => `${a.fromBlock}-${a.toBlock}`);
    expect(windows).toEqual(["1001-2000", "2001-3000", "3001-4000"]);
    expect(cursorSets()).toEqual([{ p_chain: 59141, p_safe: SAFE, p_block: "4000" }]);
    // the cursor moves only after the ops were stored
    const names = rpc.mock.calls.map((c) => c[0]);
    expect(names.indexOf("set_dao_eth_cursor")).toBeGreaterThan(names.indexOf("record_safe_scan"));
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
