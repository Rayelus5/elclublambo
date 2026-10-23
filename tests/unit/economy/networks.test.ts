import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import {
  appChainIds,
  bpsToPercentText,
  CHAIN_IDS,
  chainForKey,
  chainsForSet,
  explorerAddress,
  explorerBlock,
  explorerTx,
  isChainId,
  networkSet,
  NETWORKS,
  percentTextToBps,
} from "@/lib/economy/networks";

describe("NETWORKS", () => {
  it("has the four chains", () => {
    expect(CHAIN_IDS).toEqual([8453, 42161, 84532, 421614]);
    expect(Object.keys(NETWORKS).map(Number).sort()).toEqual([8453, 42161, 84532, 421614].sort());
  });

  it("pins Circle's native USDC per chain (checksummed)", () => {
    const usdc = Object.fromEntries(CHAIN_IDS.map((c) => [c, NETWORKS[c].usdc]));
    expect(usdc).toEqual({
      8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    });
    for (const c of CHAIN_IDS) expect(NETWORKS[c].usdc).toBe(getAddress(NETWORKS[c].usdc));
  });

  it("keys, names, testnet flags, server RPC env and logos", () => {
    expect(CHAIN_IDS.map((c) => [NETWORKS[c].key, NETWORKS[c].name, NETWORKS[c].testnet, NETWORKS[c].serverRpcEnv, NETWORKS[c].logo])).toEqual([
      ["base", "Base", false, "BASE_RPC_URL", "/brand/networks/base.svg"],
      ["arbitrum", "Arbitrum", false, "ARBITRUM_RPC_URL", "/brand/networks/arbitrum.svg"],
      ["base", "Base Sepolia", true, "BASE_SEPOLIA_RPC_URL", "/brand/networks/base.svg"],
      ["arbitrum", "Arbitrum Sepolia", true, "ARBITRUM_SEPOLIA_RPC_URL", "/brand/networks/arbitrum.svg"],
    ]);
  });

  it("each viemChain matches its id", () => {
    for (const c of CHAIN_IDS) {
      expect(NETWORKS[c].id).toBe(c);
      expect(NETWORKS[c].viemChain.id).toBe(c);
    }
  });

  it("finality per network: Base {3, 2000, 10}, Arbitrum {20, 2000, 40}", () => {
    for (const c of [8453, 84532] as const) expect(NETWORKS[c].finality).toEqual({ tipConfirmations: 3, scanChunkBlocks: 2000, maxScanChunks: 10 });
    for (const c of [42161, 421614] as const) expect(NETWORKS[c].finality).toEqual({ tipConfirmations: 20, scanChunkBlocks: 2000, maxScanChunks: 40 });
  });

  it("has no WETH or price feed fields (P0-R8)", () => {
    for (const c of CHAIN_IDS) {
      expect(NETWORKS[c]).not.toHaveProperty("weth");
      expect(NETWORKS[c]).not.toHaveProperty("ethUsdFeed");
      expect(NETWORKS[c]).not.toHaveProperty("ethUsdHeartbeatSec");
    }
  });

  it("builds explorer links", () => {
    expect(explorerTx(8453, "0xab")).toBe("https://basescan.org/tx/0xab");
    expect(explorerTx(421614, "0xab").startsWith("https://sepolia.arbiscan.io/tx/")).toBe(true);
    expect(explorerTx(84532, "0xab")).toBe("https://sepolia.basescan.org/tx/0xab");
    expect(explorerAddress(42161, "0xcd")).toBe("https://arbiscan.io/address/0xcd");
    expect(explorerBlock(8453, 12n)).toBe("https://basescan.org/block/12");
  });
});

describe("isChainId", () => {
  it("accepts the four chains and rejects Linea and junk", () => {
    for (const c of [8453, 42161, 84532, 421614]) expect(isChainId(c)).toBe(true);
    for (const c of [59141, 59144, 1, "8453", null, undefined]) expect(isChainId(c)).toBe(false);
  });
});

describe("network sets", () => {
  it("chainsForSet", () => {
    expect(chainsForSet("mainnet")).toEqual([8453, 42161]);
    expect(chainsForSet("testnet")).toEqual([84532, 421614]);
  });

  it("networkSet: undefined is testnet, unknown throws", () => {
    expect(networkSet(undefined)).toBe("testnet");
    expect(networkSet("mainnet")).toBe("mainnet");
    expect(networkSet("testnet")).toBe("testnet");
    expect(() => networkSet("linea")).toThrow();
  });

  it("appChainIds follows the build set (testnet in the test env)", () => {
    expect(appChainIds()).toEqual([84532, 421614]);
  });

  it("chainForKey picks the build's chain for a network key", () => {
    expect(chainForKey("base")).toBe(84532);
    expect(chainForKey("arbitrum")).toBe(421614);
  });
});

describe("percentTextToBps", () => {
  it("accepts comma or dot decimals up to 2 places", () => {
    expect(percentTextToBps("2,6")).toBe(260);
    expect(percentTextToBps("2.6")).toBe(260);
    expect(percentTextToBps("0,05")).toBe(5);
    expect(percentTextToBps("0")).toBe(0);
    expect(percentTextToBps(" 1 ")).toBe(100);
    expect(percentTextToBps("50")).toBe(5000);
  });

  it("rejects out of range or malformed input", () => {
    for (const bad of ["50,01", "51", "100", "1,234", "-1", "", "abc", "1,", ",5", "1e1"]) {
      expect(percentTextToBps(bad), bad).toBeNull();
    }
  });
});

describe("bpsToPercentText", () => {
  it("formats with a decimal comma", () => {
    expect(bpsToPercentText(260)).toBe("2,6 %");
    expect(bpsToPercentText(5)).toBe("0,05 %");
    expect(bpsToPercentText(0)).toBe("0 %");
    expect(bpsToPercentText(5000)).toBe("50 %");
  });
});
