import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readContract = vi.fn();
const chainClient = vi.fn<(c: number) => object>(() => ({ readContract: (...a: unknown[]) => readContract(...a) }));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: (c: number) => chainClient(c) }));

const rpc = vi.fn();
const tables: Record<string, unknown> = {};
let cfgError: unknown = null;
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: tables[table] ?? null, error: table === "chain_config" ? cfgError : null });
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) }) }));

import { reconcile } from "@/lib/treasury/reconcile";
import { NETWORKS } from "@/lib/economy/networks";

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const result = (over: Record<string, string> = {}) => ({
  id: "rec1", ledgerValue: "5000000", pendingValue: "0", rawDiff: "2000000", diff: "2000000", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  cfgError = null;
  tables.chain_config = { safe_address: SAFE };
  readContract.mockResolvedValue(7000000n);
  rpc.mockResolvedValue({ data: result(), error: null });
});

describe("reconcile", () => {
  it("reads the Safe's USDC balance with erc20 balanceOf and sends only the balance to the RPC", async () => {
    await reconcile(59141, "member-1");
    expect(chainClient).toHaveBeenCalledWith(59141);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: NETWORKS[59141].usdc, functionName: "balanceOf", args: [SAFE] }),
    );
    expect(rpc).toHaveBeenCalledWith("record_reconciliation", { p_chain: 59141, p_onchain: "7000000", p_actor: "member-1" });
  });

  it("returns the RPC's snapshot: effective diff, raw diff and pending value", async () => {
    rpc.mockResolvedValue({ data: result({ pendingValue: "1500000", rawDiff: "2000000", diff: "500000" }), error: null });
    expect(await reconcile(59141, null)).toEqual({
      ledgerValue: 5000000n, pendingValue: 1500000n, onchainBalance: 7000000n, diff: 500000n, rawDiff: 2000000n, id: "rec1",
    });
  });

  it("keeps a negative diff signed", async () => {
    rpc.mockResolvedValue({ data: result({ rawDiff: "-4999999", diff: "-4999999" }), error: null });
    expect((await reconcile(59141, null)).diff).toBe(-4999999n);
  });

  it("passes a null actor for cron", async () => {
    await reconcile(59141, null);
    expect(rpc).toHaveBeenCalledWith("record_reconciliation", expect.objectContaining({ p_actor: null }));
  });

  it("throws safe_not_configured when the chain has no Safe, without reading the chain", async () => {
    tables.chain_config = { safe_address: null };
    await expect(reconcile(59141, null)).rejects.toThrow("safe_not_configured");
    expect(readContract).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a chain_config read error throws (not safe_not_configured) and records nothing", async () => {
    cfgError = { message: "db down" };
    await expect(reconcile(59141, null)).rejects.toThrow(/chain_config read failed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an RPC failure throws and records nothing", async () => {
    readContract.mockRejectedValue(new Error("down"));
    await expect(reconcile(59141, null)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a failing or malformed record_reconciliation, never defaulting to 0", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "chain_invalid" } });
    await expect(reconcile(59141, null)).rejects.toThrow();
    rpc.mockResolvedValue({ data: { id: "r", ledgerValue: null }, error: null });
    await expect(reconcile(59141, null)).rejects.toThrow();
  });
});
