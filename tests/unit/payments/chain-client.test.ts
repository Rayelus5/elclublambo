import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { chainClient } from "@/lib/payments/chain-client";
import { legacyChainClient } from "@/lib/legacy/linea-client";

describe("chainClient", () => {
  it("uses the network's server RPC env var and viem chain", () => {
    const c = chainClient(84532, { BASE_SEPOLIA_RPC_URL: "http://x:1" });
    expect(c.chain?.id).toBe(84532);
    expect(c.transport.url).toBe("http://x:1");
  });

  it("falls back to the chain's public RPC when the env var is empty or for another chain", () => {
    expect(chainClient(421614, { BASE_SEPOLIA_RPC_URL: "http://x:1", ARBITRUM_SEPOLIA_RPC_URL: "" }).transport.url).toBe(
      "https://sepolia-rollup.arbitrum.io/rpc",
    );
    const main = chainClient(8453, { BASE_RPC_URL: "http://b:2" });
    expect(main.chain?.id).toBe(8453);
    expect(main.transport.url).toBe("http://b:2");
    expect(chainClient(42161, { ARBITRUM_RPC_URL: "http://a:3" }).transport.url).toBe("http://a:3");
  });
});

describe("legacyChainClient", () => {
  it("uses Linea's public RPC", () => {
    const c = legacyChainClient(59141);
    expect(c.chain?.id).toBe(59141);
    expect(legacyChainClient(59144).chain?.id).toBe(59144);
  });
});
