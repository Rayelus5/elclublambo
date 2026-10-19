import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readSafeAssets = vi.fn();
const readEthPrice = vi.fn();
vi.mock("@/lib/treasury/valuation", async (orig) => ({
  ...(await orig<typeof import("@/lib/treasury/valuation")>()),
  readSafeAssets: (...a: unknown[]) => readSafeAssets(...a),
  readEthPrice: (...a: unknown[]) => readEthPrice(...a),
}));

const rpc = vi.fn();
/** dao_valuation_cap's reply (F4c-R7 a); every other RPC goes to `rpc`. */
let cap: { data: unknown; error: unknown } = { data: { capped: false, block: null }, error: null };
const rpcCalls: string[] = [];
const rows: Record<string, unknown> = {};
const errors: Record<string, unknown> = {};
const calls: unknown[][] = [];
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = (...a: unknown[]) => (calls.push([table, m, ...a]), b);
  b.maybeSingle = async () => ({ data: errors[table] ? null : (rows[table] ?? null), error: errors[table] ?? null });
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => (rpcCalls.push(String(a[0])), a[0] === "dao_valuation_cap" ? Promise.resolve(cap) : rpc(...a)) }) }));

import { takeSnapshot, valueSafe } from "@/lib/treasury/snapshot";

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
// 5 USDC + 0.5 ETH + 0.25 WETH at 2000.12345678 USD/ETH: floor(0.75e18 · 200012345678 / 1e20) = 1500092592 (USD6)
const ASSETS = { usdc: 5_000_000n, eth: 500_000_000_000_000_000n, weth: 250_000_000_000_000_000n, blockNumber: 777n };
const PRICE = 200_012_345_678n;
const EXPECTED_USD6 = 5_000_000n + 1_500_092_592n;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  rpcCalls.length = 0;
  cap = { data: { capped: false, block: null }, error: null };
  for (const k of Object.keys(rows)) delete rows[k];
  for (const k of Object.keys(errors)) delete errors[k];
  rows.chain_config = { safe_address: SAFE };
  rows.dao_nav_snapshots = { eth_price_e8: "199900000000" };
  readSafeAssets.mockResolvedValue(ASSETS);
  readEthPrice.mockResolvedValue({ priceE8: PRICE, source: "chainlink" });
  rpc.mockResolvedValue({ data: { id: "s1", navUsd6: "1", clubMinted: "0", skipped: false }, error: null });
});

describe("valueSafe", () => {
  it("values the Safe's assets at the price, exactly as record_nav_snapshot checks, with the read block", async () => {
    const v = await valueSafe(59141);
    expect(v).toEqual({ assetsUsd6: EXPECTED_USD6, priceE8: PRICE, source: "chainlink", assets: ASSETS, blockNumber: 777n, safe: SAFE });
    expect(readSafeAssets).toHaveBeenCalledWith(59141, SAFE);
    expect(calls).toContainEqual(["chain_config", "eq", "chain_id", 59141]);
  });

  it("F4c-R7 (a): with approved, unpaid withdrawals the Safe is read at the scan cursor at most", async () => {
    cap = { data: { capped: true, block: "700" }, error: null };
    const v = await valueSafe(59141);
    expect(readSafeAssets).toHaveBeenCalledWith(59141, SAFE, { maxBlock: 700n });
    expect(v?.blockNumber).toBe(777n); // whatever block the read reports is what SQL checks
    expect(rpcCalls).toContain("dao_valuation_cap");
  });

  it("F4c-R7 (a): capped without a scan cursor there is nothing to trust: null, no chain read", async () => {
    cap = { data: { capped: true, block: null }, error: null };
    expect(await valueSafe(59141)).toBeNull();
    expect(readSafeAssets).not.toHaveBeenCalled();
  });

  it("not capped: read at the latest block (credits keep working without the cron)", async () => {
    cap = { data: { capped: false, block: "700" }, error: null };
    await valueSafe(59141);
    expect(readSafeAssets).toHaveBeenCalledWith(59141, SAFE);
  });

  it("throws when the cap cannot be read (no read at an unchecked block)", async () => {
    cap = { data: null, error: { message: "db down" } };
    await expect(valueSafe(59141)).rejects.toThrow(/dao_valuation_cap/);
    expect(readSafeAssets).not.toHaveBeenCalled();
  });

  it("passes the latest snapshot's price as lastPriceE8 (CoinGecko sanity check)", async () => {
    await valueSafe(59141);
    expect(readEthPrice).toHaveBeenCalledWith(59141, { lastPriceE8: 199_900_000_000n });
    expect(calls).toContainEqual(["dao_nav_snapshots", "eq", "chain_id", 59141]);
    expect(calls).toContainEqual(["dao_nav_snapshots", "order", "taken_at", { ascending: false }]);
  });

  it("lastPriceE8 is null when the chain has no snapshot yet", async () => {
    delete rows.dao_nav_snapshots;
    await valueSafe(59141);
    expect(readEthPrice).toHaveBeenCalledWith(59141, { lastPriceE8: null });
  });

  it("null when the Safe is not configured, without touching the chain", async () => {
    rows.chain_config = { safe_address: null };
    expect(await valueSafe(59141)).toBeNull();
    expect(readSafeAssets).not.toHaveBeenCalled();
  });

  it("null when there is no price (nothing is made up)", async () => {
    readEthPrice.mockResolvedValue(null);
    expect(await valueSafe(59141)).toBeNull();
  });

  it("null when the balances cannot be read", async () => {
    readSafeAssets.mockRejectedValue(new Error("rpc down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await valueSafe(59141)).toBeNull();
    err.mockRestore();
  });

  it("throws when the last snapshot cannot be read (no unchecked CoinGecko price; the cron reports it)", async () => {
    errors.dao_nav_snapshots = { message: "db down" };
    await expect(valueSafe(59141)).rejects.toThrow(/dao_nav_snapshots/);
    expect(readEthPrice).not.toHaveBeenCalled();
  });

  it("throws when chain_config cannot be read, so takeSnapshot fails instead of saying unavailable", async () => {
    errors.chain_config = { message: "db down" };
    await expect(valueSafe(59141)).rejects.toThrow(/chain_config/);
    await expect(takeSnapshot(59141)).rejects.toThrow(/chain_config/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("takeSnapshot", () => {
  it("records the valuation with every integer as a string", async () => {
    expect(await takeSnapshot(59141)).toBe("taken");
    expect(rpc).toHaveBeenCalledWith("record_nav_snapshot", {
      p_chain: 59141,
      p_safe: SAFE,
      p_snapshot: {
        usdcUnits: "5000000",
        ethWei: "500000000000000000",
        wethWei: "250000000000000000",
        ethPriceE8: "200012345678",
        priceSource: "chainlink",
        blockNumber: "777",
        assetsUsd6: EXPECTED_USD6.toString(),
      },
    });
  });

  it("passes the Safe address valueSafe read (F4c: SQL refuses it if chain_config changed meanwhile)", async () => {
    const mixed = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
    rows.chain_config = { safe_address: mixed };
    await takeSnapshot(59141);
    expect(readSafeAssets).toHaveBeenCalledWith(59141, mixed);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_safe: mixed });
  });

  it('"skipped" when the RPC throttles (55 minutes)', async () => {
    rpc.mockResolvedValue({ data: { id: "s0", navUsd6: "1", clubMinted: "0", skipped: true }, error: null });
    expect(await takeSnapshot(59141)).toBe("skipped");
  });

  it('"unavailable" and no RPC when the Safe cannot be valued', async () => {
    readEthPrice.mockResolvedValue(null);
    expect(await takeSnapshot(59141)).toBe("unavailable");
    expect(rpc).not.toHaveBeenCalled();
    expect(rpcCalls).not.toContain("record_nav_snapshot");
  });

  it("an RPC error throws (the cron reports it)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "invalid_input" } });
    await expect(takeSnapshot(59141)).rejects.toThrow(/record_nav_snapshot/);
  });
});
