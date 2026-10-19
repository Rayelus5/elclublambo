import { beforeEach, describe, expect, it, vi } from "vitest";

// F5 Task 3: the app offers MetaMask and OKX only. AppKit adds the Coinbase Wallet and Base Account connectors unless
// told not to, and creating the Coinbase connector loads Coinbase's telemetry script (cca-lite.coinbase.com), which the
// CSP blocks. Both stay off, so the page never reaches out to Coinbase.

const h = vi.hoisted(() => ({ createAppKit: vi.fn(() => ({})) }));
vi.mock("@reown/appkit/react", () => ({ createAppKit: h.createAppKit }));
vi.mock("@reown/appkit-adapter-wagmi", () => ({
  WagmiAdapter: class {
    constructor(public opts: unknown) {}
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.createAppKit.mockClear();
  vi.stubEnv("NEXT_PUBLIC_REOWN_PROJECT_ID", "test-project");
});

describe("appKit", () => {
  it("disables the Coinbase Wallet and Base Account connectors", async () => {
    await import("@/lib/web3/appkit");
    expect(h.createAppKit).toHaveBeenCalledTimes(1);
    const opts = (h.createAppKit.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(opts.enableCoinbase).toBe(false);
    expect(opts.enableBaseAccount).toBe(false);
    expect(opts.includeWalletIds).toHaveLength(2);
  });
});
