import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readContract = vi.fn();
const chainClient = vi.fn<(c: number) => object>(() => ({ readContract: (...a: unknown[]) => readContract(...a) }));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: (c: number) => chainClient(c) }));

const rpc = vi.fn();
const tables: Record<string, unknown> = {};
function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: tables[table] ?? null, error: null });
  return b;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t), rpc: (...a: unknown[]) => rpc(...a) }) }));

import { reconcile } from "@/lib/treasury/reconcile";
import { NETWORKS } from "@/lib/economy/networks";

const SAFE = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  tables.chain_config = { safe_address: SAFE };
  tables.dao_state = { value_usdc: "5000000" };
  readContract.mockResolvedValue(7000000n);
  rpc.mockResolvedValue({ data: "rec1", error: null });
});

describe("reconcile", () => {
  it("reads the Safe's USDC balance with erc20 balanceOf", async () => {
    await reconcile(59141, null);
    expect(chainClient).toHaveBeenCalledWith(59141);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: NETWORKS[59141].usdc, functionName: "balanceOf", args: [SAFE] }),
    );
  });

  it("a positive diff means funds in the Safe that are not in the ledger", async () => {
    const r = await reconcile(59141, "member-1");
    expect(r).toEqual({ ledgerValue: 5000000n, onchainBalance: 7000000n, diff: 2000000n, id: "rec1" });
    expect(rpc).toHaveBeenCalledWith("record_reconciliation", { p_chain: 59141, p_ledger: "5000000", p_onchain: "7000000", p_actor: "member-1" });
  });

  it("a negative diff means the Safe holds less than the ledger", async () => {
    readContract.mockResolvedValue(1n);
    expect((await reconcile(59141, null)).diff).toBe(-4999999n);
  });

  it("a zero diff is still recorded, with a null actor for cron", async () => {
    readContract.mockResolvedValue(5000000n);
    expect((await reconcile(59141, null)).diff).toBe(0n);
    expect(rpc).toHaveBeenCalledWith("record_reconciliation", expect.objectContaining({ p_actor: null }));
  });

  it("throws safe_not_configured when the chain has no Safe, without reading the chain", async () => {
    tables.chain_config = { safe_address: null };
    await expect(reconcile(59141, null)).rejects.toThrow("safe_not_configured");
    expect(readContract).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an RPC failure throws and records nothing", async () => {
    readContract.mockRejectedValue(new Error("down"));
    await expect(reconcile(59141, null)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces a failing record_reconciliation", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "chain_invalid" } });
    await expect(reconcile(59141, null)).rejects.toThrow();
  });
});
