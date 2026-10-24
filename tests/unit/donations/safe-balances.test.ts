import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const getBalance = vi.hoisted(() => vi.fn());
const readContract = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: (chain: number) => ({ getBalance: (a: unknown) => getBalance(chain, a), readContract: (a: unknown) => readContract(chain, a) }) }));

const SAFE = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
const db = vi.hoisted(() => ({ rows: [] as { chain_id: number; safe_address: string | null }[], error: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = async () => (db.error ? { data: null, error: db.error } : { data: db.rows, error: null });
      return b;
    },
  }),
}));

import { getSafeBalances } from "@/lib/donations/safe-balances";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.rows = [
    { chain_id: 84532, safe_address: SAFE },
    { chain_id: 421614, safe_address: SAFE },
  ];
  db.error = null;
});

describe("getSafeBalances", () => {
  it("reads USDC (balanceOf) and ETH of the Safe on every network of the build", async () => {
    getBalance.mockResolvedValue(3n * 10n ** 17n);
    readContract.mockImplementation(async (chain: number) => (chain === 84532 ? 12_000_000n : 0n));
    expect(await getSafeBalances()).toEqual([
      { chainId: 84532, usdc: 12_000_000n, eth: 3n * 10n ** 17n },
      { chainId: 421614, usdc: 0n, eth: 3n * 10n ** 17n },
    ]);
    expect(readContract).toHaveBeenCalledWith(84532, expect.objectContaining({ address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", functionName: "balanceOf", args: [SAFE] }));
    expect(getBalance).toHaveBeenCalledWith(421614, { address: SAFE });
  });

  it("a failed read is null for that asset only", async () => {
    getBalance.mockImplementation(async (chain: number) => {
      if (chain === 421614) throw new Error("rpc down");
      return 1n;
    });
    readContract.mockResolvedValue(5n);
    expect(await getSafeBalances()).toEqual([
      { chainId: 84532, usdc: 5n, eth: 1n },
      { chainId: 421614, usdc: 5n, eth: null },
    ]);
  });

  it("no Safe stored for a network (or the read of chains failed): nulls, no RPC", async () => {
    db.rows = [{ chain_id: 84532, safe_address: null }];
    expect(await getSafeBalances()).toEqual([
      { chainId: 84532, usdc: null, eth: null },
      { chainId: 421614, usdc: null, eth: null },
    ]);
    db.error = { message: "boom" };
    expect(await getSafeBalances()).toEqual([
      { chainId: 84532, usdc: null, eth: null },
      { chainId: 421614, usdc: null, eth: null },
    ]);
    expect(getBalance).not.toHaveBeenCalled();
  });
});
