import { describe, expect, it } from "vitest";
import { assetId, assetsFor, parseAssetId, rankAssets, type AssetBalances } from "@/lib/economy/assets";
import { NETWORKS } from "@/lib/economy/networks";

describe("assetId / parseAssetId", () => {
  it("round-trips a USDC and an ETH asset", () => {
    expect(assetId("USDC", 84532)).toBe("USDC:84532");
    expect(parseAssetId("USDC:84532")).toEqual({ id: "USDC:84532", token: "USDC", chainId: 84532, decimals: 6, contract: NETWORKS[84532].usdc });
    expect(parseAssetId("ETH:421614")).toEqual({ id: "ETH:421614", token: "ETH", chainId: 421614, decimals: 18, contract: null });
  });

  it("rejects unknown chains, tokens and junk", () => {
    for (const s of ["USDC:1", "USDC:59141", "WETH:84532", "USDC", "USDC:84532:1", "", "usdc:84532", "USDC: 84532"]) {
      expect(parseAssetId(s), s).toBeNull();
    }
  });
});

describe("assetsFor", () => {
  it("lists USDC of every chain in order, then ETH", () => {
    expect(assetsFor([84532, 421614]).map((a) => a.id)).toEqual(["USDC:84532", "USDC:421614", "ETH:84532", "ETH:421614"]);
  });

  it("keeps only the accepted networks", () => {
    expect(assetsFor([84532, 421614], ["arbitrum"]).map((a) => a.id)).toEqual(["USDC:421614", "ETH:421614"]);
    expect(assetsFor([84532, 421614], [])).toEqual([]);
  });
});

describe("rankAssets", () => {
  const all = assetsFor([84532, 421614]);
  const ids = (b: AssetBalances, amount: bigint | null) => rankAssets(all, b, amount).map((a) => a.id);

  it("payable first, unknown balances last", () => {
    const balances: AssetBalances = { "USDC:84532": 5_000_000n, "ETH:84532": 1n, "USDC:421614": 0n };
    const out = ids(balances, 1_000_000n);
    expect(out[0]).toBe("USDC:84532");
    // ETH:84532 has 1 wei (rank 1), USDC:421614 is 0 (rank 2), ETH:421614 unknown (rank 3).
    expect(out).toEqual(["USDC:84532", "ETH:84532", "USDC:421614", "ETH:421614"]);
  });

  it("USDC with balance but no ETH for gas on that chain is rank 1", () => {
    const balances: AssetBalances = { "USDC:84532": 5_000_000n, "ETH:84532": 0n, "USDC:421614": 2_000_000n, "ETH:421614": 10n ** 15n };
    expect(ids(balances, 1_000_000n)).toEqual(["USDC:421614", "ETH:421614", "USDC:84532", "ETH:84532"]);
  });

  it("USDC with unknown ETH on that chain is not payable", () => {
    expect(ids({ "USDC:84532": 5_000_000n, "ETH:84532": null, "ETH:421614": 2_000_000n }, 1_000_000n)).toEqual([
      "ETH:421614",
      "USDC:84532",
      "USDC:421614",
      "ETH:84532",
    ]);
  });

  it("ETH needs more than the amount (gas): equal is rank 1", () => {
    const amount = 10n ** 15n;
    expect(ids({ "ETH:84532": amount, "ETH:421614": amount + 1n }, amount).slice(0, 2)).toEqual(["ETH:421614", "ETH:84532"]);
  });

  it("USDC equal to the amount is payable", () => {
    expect(ids({ "USDC:421614": 1_000_000n, "ETH:421614": 1n, "USDC:84532": 999_999n, "ETH:84532": 1n }, 1_000_000n)[0]).toBe("USDC:421614");
  });

  it("with no amount any positive balance is payable; order is stable within a rank", () => {
    const balances: AssetBalances = { "USDC:84532": 1n, "ETH:84532": 1n, "USDC:421614": 1n, "ETH:421614": 1n };
    expect(ids(balances, null)).toEqual(["USDC:84532", "USDC:421614", "ETH:84532", "ETH:421614"]);
    expect(ids({}, null)).toEqual(["USDC:84532", "USDC:421614", "ETH:84532", "ETH:421614"]);
  });
});
