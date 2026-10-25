import { describe, expect, it } from "vitest";
import { LOW_LIQUIDITY_USD, NEW_CONTRACT_DAYS, tokenAlerts } from "@/lib/checker/token/alerts";
import { ok, unknown, type TokenFacts } from "@/lib/checker/token/types";

/** A clean, established, verified, renounced token with deep liquidity: no alert. */
function facts(over: Partial<TokenFacts> = {}): TokenFacts {
  return {
    chainId: 8453,
    address: "0x1111111111111111111111111111111111111111",
    code: ok({ hasCode: true }),
    erc20: ok({ name: "Token", symbol: "TKN", decimals: 18, totalSupply: "1000" }),
    proxy: ok({ isProxy: false, implementation: null }),
    owner: ok({ owner: "0x0000000000000000000000000000000000000000", renounced: true }),
    verification: ok({ verified: true, source: "blockscout", abiFlags: [] }),
    creation: ok({ creator: "0x2222222222222222222222222222222222222222", createdAt: "2025-01-01T00:00:00.000Z", ageDays: 400, ageUnknown: null, isScam: false }),
    market: ok({ pairs: 3, liquidityUsd: 2_000_000, priceUsd: "1.00", fdv: 1e9, topPairUrl: "https://dexscreener.com/base/0xpair" }),
    ...over,
  };
}

const codes = (f: TokenFacts) => tokenAlerts(f).map((a) => `${a.code}:${a.severity}`);

describe("tokenAlerts (P4-R2)", () => {
  it("a clean token raises nothing", () => {
    expect(tokenAlerts(facts())).toEqual([]);
  });

  it("thresholds are constants", () => {
    expect(LOW_LIQUIDITY_USD).toBe(10_000);
    expect(NEW_CONTRACT_DAYS).toBe(7);
  });

  it("no code is high and the contract-only alerts are not raised for it", () => {
    const f = facts({
      code: ok({ hasCode: false }),
      erc20: ok(null),
      proxy: ok({ isProxy: false, implementation: null }),
      owner: ok(null),
      verification: ok({ verified: false, source: "blockscout", abiFlags: [] }),
      market: ok({ pairs: 0, liquidityUsd: null, priceUsd: null, fdv: null, topPairUrl: null }),
    });
    expect(codes(f)).toEqual(["no_code:high"]);
  });

  it("scam flag is high", () => {
    expect(codes(facts({ creation: ok({ creator: null, createdAt: null, ageDays: null, ageUnknown: null, isScam: true }) }))).toEqual(["scam_flag:high"]);
  });

  it("unverified is medium", () => {
    expect(codes(facts({ verification: ok({ verified: false, source: "sourcify", abiFlags: [] }) }))).toEqual(["unverified:medium"]);
  });

  it("created 2 days ago is medium; 7 days is not new", () => {
    const c = (ageDays: number) => facts({ creation: ok({ creator: null, createdAt: "x", ageDays, ageUnknown: null, isScam: false }) });
    expect(codes(c(2))).toEqual(["new_contract:medium"]);
    expect(codes(c(7))).toEqual([]);
  });

  it("no pairs is medium (and no liquidity alert on top)", () => {
    expect(codes(facts({ market: ok({ pairs: 0, liquidityUsd: null, priceUsd: null, fdv: null, topPairUrl: null }) }))).toEqual(["no_pairs:medium"]);
  });

  it("liquidity 5 000 is low; 10 000 is not", () => {
    const m = (liquidityUsd: number) => facts({ market: ok({ pairs: 1, liquidityUsd, priceUsd: "1", fdv: null, topPairUrl: null }) });
    expect(codes(m(5_000))).toEqual(["low_liquidity:medium"]);
    expect(codes(m(10_000))).toEqual([]);
  });

  it("an upgradeable proxy is medium", () => {
    expect(codes(facts({ proxy: ok({ isProxy: true, implementation: "0x3333333333333333333333333333333333333333" }) }))).toEqual(["upgradeable_proxy:medium"]);
  });

  it("an owner not renounced is info; no owner() raises nothing", () => {
    expect(codes(facts({ owner: ok({ owner: "0x4444444444444444444444444444444444444444", renounced: false }) }))).toEqual(["owner_active:info"]);
    expect(codes(facts({ owner: ok(null) }))).toEqual([]);
  });

  it("unknown ABI flags or an unknown age never raise (nor count as safe)", () => {
    expect(codes(facts({ verification: ok({ verified: true, source: "blockscout", abiFlags: null }) }))).toEqual([]);
    expect(codes(facts({ creation: ok({ creator: null, createdAt: null, ageDays: null, ageUnknown: "timeout", isScam: false }) }))).toEqual([]);
  });

  it("privileged ABI functions are info", () => {
    expect(codes(facts({ verification: ok({ verified: true, source: "sourcify", abiFlags: ["mint", "blacklist"] }) }))).toEqual(["abi_privileged:info"]);
  });

  it("never alerts from an unknown section", () => {
    const f = facts({
      code: unknown("timeout"),
      erc20: unknown("timeout"),
      proxy: unknown("timeout"),
      owner: unknown("timeout"),
      verification: unknown("blocked"),
      creation: unknown("blocked"),
      market: unknown("unsupported"),
    });
    expect(tokenAlerts(f)).toEqual([]);
  });

  it("orders high before medium before info", () => {
    const f = facts({
      owner: ok({ owner: "0x4444444444444444444444444444444444444444", renounced: false }),
      verification: ok({ verified: false, source: "blockscout", abiFlags: [] }),
      creation: ok({ creator: null, createdAt: null, ageDays: 1, ageUnknown: null, isScam: true }),
    });
    expect(codes(f)).toEqual(["scam_flag:high", "unverified:medium", "new_contract:medium", "owner_active:info"]);
  });
});
