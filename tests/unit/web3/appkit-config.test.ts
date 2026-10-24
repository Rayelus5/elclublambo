import { beforeEach, describe, expect, it, vi } from "vitest";

// F5 Task 3: the app offers MetaMask and OKX only. AppKit adds the Coinbase Wallet and Base Account connectors unless
// told not to, and creating the Coinbase connector loads Coinbase's telemetry script (cca-lite.coinbase.com), which the
// CSP blocks. Both stay off, so the page never reaches out to Coinbase. P0 (D5) also accepts EOAs only: Supabase
// verifies SIWE signatures with ecrecover, so a smart-wallet (Base Account) signature would not log in.

const h = vi.hoisted(() => ({
  createAppKit: vi.fn(() => ({})),
  adapterOpts: [] as Record<string, unknown>[],
}));
vi.mock("@reown/appkit/react", () => ({ createAppKit: h.createAppKit }));
// Light chain stubs: loading viem/chains afresh (resetModules) took about a second alone and past the 5 s timeout in
// the full parallel suite. The real networks.ts / chains.ts still pick the set's chains from them.
vi.mock("viem/chains", () => ({
  base: { id: 8453 },
  arbitrum: { id: 42161 },
  baseSepolia: { id: 84532 },
  arbitrumSepolia: { id: 421614 },
}));
vi.mock("@reown/appkit-adapter-wagmi", () => ({
  WagmiAdapter: class {
    constructor(public opts: Record<string, unknown>) {
      h.adapterOpts.push(opts);
    }
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  h.createAppKit.mockClear();
  h.adapterOpts.length = 0;
  vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "test-project");
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  vi.stubEnv("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL", "");
  vi.stubEnv("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL", "");
});

async function appKitOpts() {
  await import("@/lib/web3/appkit");
  expect(h.createAppKit).toHaveBeenCalledTimes(1);
  return (h.createAppKit.mock.calls[0] as unknown as [Record<string, unknown>])[0];
}

const ids = (v: unknown) => (v as { id: number }[]).map((n) => n.id);

describe("appKit", () => {
  it("disables the Coinbase Wallet and Base Account connectors", async () => {
    const opts = await appKitOpts();
    expect(opts.enableCoinbase).toBe(false);
    expect(opts.enableBaseAccount).toBe(false);
    expect(opts.includeWalletIds).toHaveLength(2);
  });

  it("offers the testnet set's chains, Base Sepolia first and by default", async () => {
    const opts = await appKitOpts();
    expect(ids(opts.networks)).toEqual([84532, 421614]);
    expect((opts.defaultNetwork as { id: number }).id).toBe(84532);
    expect(ids(h.adapterOpts[0]!.networks)).toEqual([84532, 421614]);
  });

  it("offers Base and Arbitrum with the mainnet set", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    const opts = await appKitOpts();
    expect(ids(opts.networks)).toEqual([8453, 42161]);
    expect((opts.defaultNetwork as { id: number }).id).toBe(8453);
  });

  it("names the app ElClub.", async () => {
    const opts = await appKitOpts();
    expect((opts.metadata as { name: string }).name).toBe("ElClub.");
  });

  it("passes no custom RPCs when the browser overrides are empty", async () => {
    await appKitOpts();
    expect(h.adapterOpts[0]!.customRpcUrls).toBeUndefined();
  });

  it("routes the two Sepolia chains to the browser RPC overrides", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:8545");
    vi.stubEnv("NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL", "http://127.0.0.1:8546");
    await appKitOpts();
    expect(h.adapterOpts[0]!.customRpcUrls).toEqual({
      "eip155:84532": [{ url: "http://127.0.0.1:8545" }],
      "eip155:421614": [{ url: "http://127.0.0.1:8546" }],
    });
  });
});
