import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { addressesFor } from "@/lib/treasury/valuation";
import {
  isLegacyChainId,
  LEGACY_CHAIN_IDS,
  LEGACY_NETWORKS,
  legacyExplorerAddress,
  legacyExplorerBlock,
  legacyExplorerTx,
} from "@/lib/legacy/linea";

describe("LEGACY_NETWORKS", () => {
  it("pins the USDC, WETH and ETH/USD feed addresses, explorers and testnet flags", () => {
    expect(LEGACY_NETWORKS[59144]).toEqual({
      id: 59144,
      name: "Linea",
      usdc: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
      weth: "0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f",
      ethUsdFeed: "0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA",
      ethUsdHeartbeatSec: 86400,
      explorer: "https://lineascan.build",
      testnet: false,
    });
    expect(LEGACY_NETWORKS[59141]).toEqual({
      id: 59141,
      name: "Linea Sepolia",
      usdc: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
      weth: "0x06565ed324Ee9fb4DB0FF80B7eDbE4Cb007555a3",
      ethUsdFeed: "0x0B553921D3282250f0FB1D1EF2aA71365A7624bc",
      ethUsdHeartbeatSec: 86400,
      explorer: "https://sepolia.lineascan.build",
      testnet: true,
    });
    expect(LEGACY_NETWORKS[59141].usdc).toBe("0xFEce4462D57bD51A6A552365A011b95f0E16d9B7");
  });

  it("ids and guards", () => {
    expect(LEGACY_CHAIN_IDS).toEqual([59144, 59141]);
    expect(isLegacyChainId(59141)).toBe(true);
    expect(isLegacyChainId(59144)).toBe(true);
    for (const c of [84532, 8453, "59141", null]) expect(isLegacyChainId(c)).toBe(false);
  });

  it("builds explorer links", () => {
    expect(legacyExplorerTx(59141, "0xab")).toBe("https://sepolia.lineascan.build/tx/0xab");
    expect(legacyExplorerTx(59144, "0xab")).toBe("https://lineascan.build/tx/0xab");
    expect(legacyExplorerAddress(59144, "0xcd")).toBe("https://lineascan.build/address/0xcd");
    expect(legacyExplorerBlock(59144, 7n)).toBe("https://lineascan.build/block/7");
  });
});

describe("mainnet pins (F5 §7)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("59144 holds the verified, checksummed addresses", () => {
    const n = LEGACY_NETWORKS[59144];
    for (const a of [n.usdc, n.weth!, n.ethUsdFeed!]) expect(a).toBe(getAddress(a));
  });

  it("addressesFor(59144) ignores every override env var", () => {
    const bad = "0x" + "0".repeat(36) + "0bad";
    for (const k of ["WETH_ADDRESS_59144", "ETH_USD_FEED_ADDRESS_59144", "WETH_ADDRESS_59141", "ETH_USD_FEED_ADDRESS_59141"]) vi.stubEnv(k, bad);
    const a = addressesFor(59144);
    expect(a.usdc).toBe(LEGACY_NETWORKS[59144].usdc);
    expect(a.weth).toBe(LEGACY_NETWORKS[59144].weth);
    expect(a.ethUsdFeed).toBe(LEGACY_NETWORKS[59144].ethUsdFeed);
  });
});
