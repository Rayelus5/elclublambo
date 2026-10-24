import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBalance = vi.fn();
const readContract = vi.fn();
vi.mock("wagmi/actions", () => ({
  getBalance: (...a: unknown[]) => getBalance(...a),
  readContract: (...a: unknown[]) => readContract(...a),
}));
vi.mock("wagmi", () => ({ useConfig: () => ({ fake: "config" }) }));

import { useAssetBalances, useInvalidateAssetBalances } from "@/lib/payments/balances";
import { assetsFor } from "@/lib/economy/assets";
import { NETWORKS } from "@/lib/economy/networks";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  getBalance.mockReset().mockImplementation(async (_c, { chainId }: { chainId: number }) => {
    if (chainId === 421614) throw new Error("rpc down");
    return { value: 5n };
  });
  readContract.mockReset().mockImplementation(async (_c, { chainId }: { chainId: number }) => BigInt(chainId));
});

describe("useAssetBalances", () => {
  it("reads every asset on its chain; a failed read is null and the rest keep their value", async () => {
    const { result } = renderHook(() => useAssetBalances(assetsFor([84532, 421614]), ACCOUNT), { wrapper });
    await waitFor(() => expect(result.current["ETH:84532"]).toBe(5n));
    await waitFor(() => expect(result.current["USDC:421614"]).toBe(421614n));
    expect(result.current["USDC:84532"]).toBe(84532n);
    // The failing read settled as an error, not still loading.
    await waitFor(() => expect(client.getQueryState(["assetBalance", "ETH:421614", ACCOUNT])?.status).toBe("error"));
    expect(result.current["ETH:421614"]).toBeNull();
    expect(readContract).toHaveBeenCalledWith(
      { fake: "config" },
      expect.objectContaining({ address: NETWORKS[84532].usdc, functionName: "balanceOf", args: [ACCOUNT], chainId: 84532 }),
    );
    expect(getBalance).toHaveBeenCalledWith({ fake: "config" }, { address: ACCOUNT, chainId: 84532 });
  });

  it("always reads ETH of each chain present, even when only USDC is listed", async () => {
    const usdcOnly = assetsFor([84532]).filter((a) => a.token === "USDC");
    const { result } = renderHook(() => useAssetBalances(usdcOnly, ACCOUNT), { wrapper });
    await waitFor(() => expect(result.current["ETH:84532"]).toBe(5n));
    expect(result.current["USDC:84532"]).toBe(84532n);
  });

  it("reuses fresh balances when the picker reopens instead of reading the chain again (staleTime)", async () => {
    const first = renderHook(() => useAssetBalances(assetsFor([84532]), ACCOUNT), { wrapper });
    await waitFor(() => expect(first.result.current["USDC:84532"]).toBe(84532n));
    const reads = getBalance.mock.calls.length + readContract.mock.calls.length;
    first.unmount();
    const second = renderHook(() => useAssetBalances(assetsFor([84532]), ACCOUNT), { wrapper });
    expect(second.result.current["USDC:84532"]).toBe(84532n);
    await new Promise((r) => setTimeout(r, 20));
    expect(getBalance.mock.calls.length + readContract.mock.calls.length).toBe(reads);
  });

  it("reads nothing without an account", () => {
    const { result } = renderHook(() => useAssetBalances(assetsFor([84532]), undefined), { wrapper });
    expect(result.current).toEqual({ "USDC:84532": null, "ETH:84532": null });
    expect(getBalance).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
  });
});

describe("useInvalidateAssetBalances", () => {
  it("re-reads every asset balance after a payment", async () => {
    const { result } = renderHook(() => ({ balances: useAssetBalances(assetsFor([84532]), ACCOUNT), invalidate: useInvalidateAssetBalances() }), { wrapper });
    await waitFor(() => expect(result.current.balances["ETH:84532"]).toBe(5n));
    const before = getBalance.mock.calls.length;
    getBalance.mockResolvedValue({ value: 7n });
    result.current.invalidate();
    await waitFor(() => expect(result.current.balances["ETH:84532"]).toBe(7n));
    expect(getBalance.mock.calls.length).toBeGreaterThan(before);
  });
});
