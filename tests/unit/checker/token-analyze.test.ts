import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractFunctionRevertedError, RpcRequestError, TimeoutError } from "viem";

vi.mock("server-only", () => ({}));
const cacheLife = vi.hoisted(() => vi.fn());
const cacheTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ cacheLife, cacheTag }));
const client = vi.hoisted(() => ({
  getCode: vi.fn(),
  getStorageAt: vi.fn(),
  multicall: vi.fn(),
  readContract: vi.fn(),
}));
const chainClient = vi.hoisted(() => vi.fn(() => client));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient }));

import { analyzeToken, getTokenReport, TOKEN_REPORT_CACHE } from "@/lib/checker/token/analyze";
import { checkerSources, CHECKER_USER_AGENT } from "@/lib/checker/token/sources";

const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const IMPL = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";
const ZERO_SLOT = `0x${"0".repeat(64)}`;
const NOW = new Date("2026-10-25T12:00:00.000Z");

type Route = (url: string) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cloudflare = () =>
  new Response("<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf</body></html>", {
    status: 403,
    headers: { "content-type": "text/html", server: "cloudflare" },
  });
const timeout = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

let routes: { blockscout: Route; sourcify: Route; dex: Route };
const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("blockscout")) return routes.blockscout(url);
  if (url.includes("sourcify")) return routes.sourcify(url);
  if (url.includes("dexscreener")) return routes.dex(url);
  throw new Error(`unexpected fetch ${url}`);
});

const blockscoutOk: Route = (url) => {
  if (url.includes("/api/v2/addresses/"))
    return json({
      is_contract: true,
      is_verified: true,
      name: "Token",
      creator_address_hash: "0x2222222222222222222222222222222222222222",
      creation_transaction_hash: "0xabc",
      implementations: [],
      proxy_type: null,
      is_scam: false,
    });
  if (url.includes("/api/v2/transactions/0xabc")) return json({ timestamp: "2025-01-01T00:00:00.000000Z" });
  if (url.includes("/api/v2/smart-contracts/"))
    return json({ is_verified: true, abi: [{ type: "function", name: "transfer" }, { type: "function", name: "balanceOf" }] });
  return json({ message: "Not found" }, 404);
};
const dexPairs = (liquidity: number) => () =>
  json([
    {
      chainId: "base",
      url: "https://dexscreener.com/base/0xpair",
      baseToken: { address: TOKEN },
      priceUsd: "1.50",
      liquidity: { usd: liquidity },
      fdv: 1_500_000,
      pairCreatedAt: 1735689600000,
    },
  ]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
  fetchMock.mockClear();
  cacheLife.mockReset();
  cacheTag.mockReset();
  chainClient.mockClear();
  routes = { blockscout: blockscoutOk, sourcify: () => json({ message: "not found" }, 404), dex: dexPairs(2_000_000) };
  client.getCode.mockReset().mockResolvedValue("0x6080604052");
  client.getStorageAt.mockReset().mockResolvedValue(ZERO_SLOT);
  client.multicall.mockReset().mockResolvedValue([
    { status: "success", result: "Token" },
    { status: "success", result: "TKN" },
    { status: "success", result: 18 },
    { status: "success", result: 1_000_000n },
  ]);
  client.readContract.mockReset().mockResolvedValue(ZERO);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const alertCodes = (r: Awaited<ReturnType<typeof analyzeToken>>) => r.alerts.map((a) => `${a.code}:${a.severity}`);

describe("analyzeToken: a healthy token", () => {
  it("fills every section and raises nothing", async () => {
    const r = await analyzeToken(8453, TOKEN);
    expect(chainClient).toHaveBeenCalledWith(8453);
    expect(r.checkedAt).toBe(NOW.toISOString());
    expect(r.facts.code).toEqual({ status: "ok", data: { hasCode: true } });
    expect(r.facts.erc20).toEqual({ status: "ok", data: { name: "Token", symbol: "TKN", decimals: 18, totalSupply: "1000000" } });
    expect(r.facts.verification).toEqual({ status: "ok", data: { verified: true, source: "blockscout", abiFlags: [] } });
    expect(r.facts.creation).toEqual({
      status: "ok",
      data: { creator: "0x2222222222222222222222222222222222222222", createdAt: "2025-01-01T00:00:00.000Z", ageDays: 662, ageUnknown: null, isScam: false },
    });
    expect(r.facts.market).toEqual({
      status: "ok",
      data: { pairs: 1, liquidityUsd: 2_000_000, priceUsd: "1.50", fdv: 1_500_000, topPairUrl: "https://dexscreener.com/base/0xpair" },
    });
    expect(r.facts.owner).toEqual({ status: "ok", data: { owner: ZERO, renounced: true } });
    expect(r.alerts).toEqual([]);
  });

  it("sends the checker's User-Agent and a timeout signal on every request", async () => {
    await analyzeToken(8453, TOKEN);
    expect(fetchMock).toHaveBeenCalled();
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("user-agent")).toBe(CHECKER_USER_AGENT);
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(CHECKER_USER_AGENT).toBe("ElClub-Checker/1 (+https://www.elclub.party)");
  });
});

describe("analyzeToken: failing sources (Review Focus 1)", () => {
  it("Blockscout 403 (Cloudflare) leaves verification/creation unknown/blocked without Sourcify", async () => {
    routes.blockscout = cloudflare;
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.verification).toEqual({ status: "unknown", reason: "blocked" });
    expect(r.facts.creation).toEqual({ status: "unknown", reason: "blocked" });
    expect(alertCodes(r)).toEqual([]);
  });

  it("Blockscout 403 + Sourcify verified → verification ok from sourcify, with the ABI flags", async () => {
    routes.blockscout = cloudflare;
    routes.sourcify = () =>
      json({
        match: "exact_match",
        creationMatch: "exact_match",
        runtimeMatch: "exact_match",
        chainId: "8453",
        address: TOKEN,
        abi: [
          { type: "function", name: "transfer" },
          { type: "function", name: "mint" },
          { type: "function", name: "setTaxFee" },
          { type: "event", name: "Blacklisted" },
        ],
      });
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.verification).toEqual({ status: "ok", data: { verified: true, source: "sourcify", abiFlags: ["mint", "setTaxFee"] } });
    expect(r.facts.creation).toEqual({ status: "unknown", reason: "blocked" });
    expect(alertCodes(r)).toEqual(["abi_privileged:info"]);
  });

  it("Blockscout says unverified and Sourcify 404 → not verified (medium)", async () => {
    routes.blockscout = (url) => {
      if (url.includes("/api/v2/addresses/")) return json({ is_contract: true, is_verified: false, creation_transaction_hash: null, is_scam: false });
      return json({}, 404);
    };
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.verification).toEqual({ status: "ok", data: { verified: false, source: "blockscout", abiFlags: [] } });
    expect(r.facts.creation).toEqual({ status: "ok", data: { creator: null, createdAt: null, ageDays: null, ageUnknown: null, isScam: false } });
    expect(alertCodes(r)).toEqual(["unverified:medium"]);
  });

  it("Blockscout 429 → rate_limited; a scam flag is high", async () => {
    routes.blockscout = () => new Response("slow down", { status: 429 });
    expect((await analyzeToken(8453, TOKEN)).facts.creation).toEqual({ status: "unknown", reason: "rate_limited" });
    routes.blockscout = (url) =>
      url.includes("/api/v2/addresses/") ? json({ is_contract: true, is_verified: true, is_scam: true }) : blockscoutOk(url);
    expect(alertCodes(await analyzeToken(8453, TOKEN))).toEqual(["scam_flag:high"]);
  });

  it("creation-tx timeout → the age is unknown (no ok age claim), creator and scam flag stay", async () => {
    routes.blockscout = (url) => (url.includes("/api/v2/transactions/") ? timeout() : blockscoutOk(url));
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.creation).toEqual({
      status: "ok",
      data: { creator: "0x2222222222222222222222222222222222222222", createdAt: null, ageDays: null, ageUnknown: "timeout", isScam: false },
    });
    expect(alertCodes(r)).toEqual([]);
  });

  it("Blockscout 404 (not indexed) for an address with code → the age is unknown/not_indexed, not silently absent", async () => {
    routes.blockscout = () => json({ message: "Not found" }, 404);
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.creation).toEqual({
      status: "ok",
      data: { creator: null, createdAt: null, ageDays: null, ageUnknown: "not_indexed", isScam: false },
    });
    expect(alertCodes(r)).not.toContain("new_contract:medium");
  });

  it("Blockscout 404 for an address without code → no creation expected (age not unknown)", async () => {
    client.getCode.mockResolvedValue("0x");
    routes.blockscout = () => json({ message: "Not found" }, 404);
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.creation).toEqual({ status: "ok", data: { creator: null, createdAt: null, ageDays: null, ageUnknown: null, isScam: false } });
  });

  it("ABI fetch 500 with no Sourcify ABI → privileged functions unknown (null), not «none»", async () => {
    routes.blockscout = (url) => (url.includes("/api/v2/smart-contracts/") ? new Response("boom", { status: 500 }) : blockscoutOk(url));
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.verification).toEqual({ status: "ok", data: { verified: true, source: "blockscout", abiFlags: null } });
    routes.sourcify = () => json({ match: "match", abi: [{ type: "function", name: "mint" }] });
    expect((await analyzeToken(8453, TOKEN)).facts.verification).toEqual({ status: "ok", data: { verified: true, source: "blockscout", abiFlags: ["mint"] } });
  });

  it("a Cloudflare challenge on a 5xx is blocked too", async () => {
    routes.blockscout = () => new Response("<title>Just a moment...</title>", { status: 503, headers: { "content-type": "text/html" } });
    expect((await analyzeToken(8453, TOKEN)).facts.creation).toEqual({ status: "unknown", reason: "blocked" });
  });

  it("an unknown chain or a malformed address throws the validation error", async () => {
    await expect(analyzeToken(1 as never, TOKEN)).rejects.toThrow("analyzeToken: invalid chain");
    await expect(analyzeToken(8453, "0x123" as never)).rejects.toThrow("analyzeToken: invalid address");
  });

  it("DexScreener timeout → market unknown/timeout and no liquidity alert", async () => {
    routes.dex = timeout;
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.market).toEqual({ status: "unknown", reason: "timeout" });
    expect(alertCodes(r)).toEqual([]);
  });

  it("an RPC timeout leaves the chain sections unknown/timeout", async () => {
    client.getCode.mockRejectedValue(new TimeoutError({ body: {}, url: "https://rpc" }));
    const r = await analyzeToken(8453, TOKEN);
    for (const s of [r.facts.code, r.facts.erc20, r.facts.proxy, r.facts.owner]) expect(s).toEqual({ status: "unknown", reason: "timeout" });
    expect(alertCodes(r)).toEqual([]);
  });

  it("a source answering garbage is an error, not a crash", async () => {
    routes.dex = () => new Response("not json", { status: 200 });
    routes.blockscout = () => new Response("boom", { status: 500 });
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.market).toEqual({ status: "unknown", reason: "error" });
    expect(r.facts.creation).toEqual({ status: "unknown", reason: "error" });
  });
});

describe("analyzeToken: what the chain says (Review Focus 2)", () => {
  it("an address without code → no_code high and erc20 ok:null", async () => {
    client.getCode.mockResolvedValue(undefined);
    routes.blockscout = (url) => (url.includes("/api/v2/addresses/") ? json({ is_contract: false, is_verified: false, is_scam: false }) : json({}, 404));
    routes.dex = () => json([]);
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.code).toEqual({ status: "ok", data: { hasCode: false } });
    expect(r.facts.erc20).toEqual({ status: "ok", data: null });
    expect(r.facts.owner).toEqual({ status: "ok", data: null });
    expect(client.multicall).not.toHaveBeenCalled();
    expect(r.alerts).toContainEqual({ code: "no_code", severity: "high" });
    expect(r.alerts[0]).toEqual({ code: "no_code", severity: "high" });
  });

  it("a contract without decimals() → erc20 ok:null (not an ERC-20)", async () => {
    client.multicall.mockResolvedValue([
      { status: "failure", error: new Error("reverted") },
      { status: "failure", error: new Error("reverted") },
      { status: "failure", error: new Error("reverted") },
      { status: "failure", error: new Error("reverted") },
    ]);
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.erc20).toEqual({ status: "ok", data: null });
  });

  it("a multicall the node never answered (allowFailure hands back the transport error) → erc20 unknown, not «not an ERC-20»", async () => {
    const err = new TimeoutError({ body: {}, url: "https://rpc" });
    client.multicall.mockResolvedValue([0, 1, 2, 3].map(() => ({ status: "failure", error: err })));
    expect((await analyzeToken(8453, TOKEN)).facts.erc20).toEqual({ status: "unknown", reason: "timeout" });
  });

  it("an EIP-1967 proxy with an implementation → proxy true (medium)", async () => {
    client.getStorageAt.mockResolvedValue(`0x000000000000000000000000${IMPL.slice(2)}`);
    const r = await analyzeToken(8453, TOKEN);
    expect(client.getStorageAt).toHaveBeenCalledWith({ address: TOKEN, slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" });
    expect(r.facts.proxy).toEqual({ status: "ok", data: { isProxy: true, implementation: IMPL } });
    expect(alertCodes(r)).toEqual(["upgradeable_proxy:medium"]);
  });

  it("owner() = 0x0 → renounced; an active owner is info; no owner() → ok:null", async () => {
    expect((await analyzeToken(8453, TOKEN)).facts.owner).toEqual({ status: "ok", data: { owner: ZERO, renounced: true } });
    client.readContract.mockResolvedValue("0x4444444444444444444444444444444444444444");
    const active = await analyzeToken(8453, TOKEN);
    expect(active.facts.owner).toEqual({ status: "ok", data: { owner: "0x4444444444444444444444444444444444444444", renounced: false } });
    expect(alertCodes(active)).toEqual(["owner_active:info"]);
    client.readContract.mockRejectedValue(new ContractFunctionRevertedError({ abi: [], functionName: "owner", message: "execution reverted" }));
    expect((await analyzeToken(8453, TOKEN)).facts.owner).toEqual({ status: "ok", data: null });
  });

  it("owner(): a JSON-RPC failure that is not a revert is unknown, not «no owner»", async () => {
    client.readContract.mockRejectedValue(new RpcRequestError({ body: {}, url: "https://rpc", error: { code: -32603, message: "internal error" } }));
    expect((await analyzeToken(8453, TOKEN)).facts.owner).toEqual({ status: "unknown", reason: "error" });
    client.readContract.mockRejectedValue(new Error("socket hang up"));
    expect((await analyzeToken(8453, TOKEN)).facts.owner).toEqual({ status: "unknown", reason: "error" });
  });

  it("created 2 days ago → new_contract", async () => {
    routes.blockscout = (url) =>
      url.includes("/api/v2/transactions/0xabc") ? json({ timestamp: "2026-10-23T12:00:00.000000Z" }) : blockscoutOk(url);
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.creation).toMatchObject({ status: "ok", data: { ageDays: 2, createdAt: "2026-10-23T12:00:00.000Z" } });
    expect(alertCodes(r)).toEqual(["new_contract:medium"]);
  });

  it("liquidity 5 000 → low_liquidity; no pairs → no_pairs", async () => {
    routes.dex = dexPairs(5_000);
    expect(alertCodes(await analyzeToken(8453, TOKEN))).toEqual(["low_liquidity:medium"]);
    routes.dex = () => json([]);
    const r = await analyzeToken(8453, TOKEN);
    expect(r.facts.market).toEqual({ status: "ok", data: { pairs: 0, liquidityUsd: null, priceUsd: null, fdv: null, topPairUrl: null } });
    expect(alertCodes(r)).toEqual(["no_pairs:medium"]);
  });

  it("testnet → market unsupported, DexScreener never asked", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    const r = await analyzeToken(84532, TOKEN);
    expect(r.facts.market).toEqual({ status: "unknown", reason: "unsupported" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("dexscreener"))).toBe(false);
    expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("https://base-sepolia.blockscout.com/api/v2/addresses/"))).toBe(true);
  });
});

describe("checkerSources", () => {
  it("maps each chain to its Blockscout host and DexScreener slug", () => {
    const env = { NEXT_PUBLIC_NETWORK_SET: "mainnet" };
    expect(checkerSources(8453, env)).toEqual({
      blockscout: "https://base.blockscout.com",
      sourcify: "https://sourcify.dev/server",
      dexscreener: { base: "https://api.dexscreener.com", slug: "base" },
    });
    expect(checkerSources(42161, env).blockscout).toBe("https://arbitrum.blockscout.com");
    expect(checkerSources(42161, env).dexscreener?.slug).toBe("arbitrum");
    expect(checkerSources(84532, env)).toMatchObject({ blockscout: "https://base-sepolia.blockscout.com", dexscreener: null });
    expect(checkerSources(421614, env).blockscout).toBe("https://arbitrum-sepolia.blockscout.com");
  });

  it("honours the env overrides on the testnet set only (e2e mocks)", () => {
    const over = {
      CHECKER_BLOCKSCOUT_BASE_8453: "http://127.0.0.1:4555/bs/",
      CHECKER_BLOCKSCOUT_BASE_84532: "http://127.0.0.1:4555/bs/",
      CHECKER_SOURCIFY_BASE: "http://127.0.0.1:4555/sourcify",
      CHECKER_DEXSCREENER_BASE: "http://127.0.0.1:4555/dex",
    };
    expect(checkerSources(84532, { ...over, NEXT_PUBLIC_NETWORK_SET: "testnet" })).toEqual({
      blockscout: "http://127.0.0.1:4555/bs",
      sourcify: "http://127.0.0.1:4555/sourcify",
      dexscreener: null,
    });
    // a mainnet chain on a testnet build (the e2e checks market parsing against the mock)
    expect(checkerSources(8453, { ...over, NEXT_PUBLIC_NETWORK_SET: "testnet" })).toEqual({
      blockscout: "http://127.0.0.1:4555/bs",
      sourcify: "http://127.0.0.1:4555/sourcify",
      dexscreener: { base: "http://127.0.0.1:4555/dex", slug: "base" },
    });
    expect(checkerSources(8453, { ...over, NEXT_PUBLIC_NETWORK_SET: "mainnet" })).toEqual({
      blockscout: "https://base.blockscout.com",
      sourcify: "https://sourcify.dev/server",
      dexscreener: { base: "https://api.dexscreener.com", slug: "base" },
    });
    expect(checkerSources(84532, { CHECKER_BLOCKSCOUT_BASE_84532: "javascript:alert(1)" }).blockscout).toBe("https://base-sepolia.blockscout.com");
  });
});

// Vitest ignores "use cache" (the per-argument memo is Next's job): these pin what the cached scope decides, i.e. its
// key (lowercased address), its lifetime and tag, and that a total failure is thrown out of the scope (not stored).
describe("getTokenReport (P4-R7)", () => {
  it("caches 10 minutes per chain and lowercased address, tagged", async () => {
    const mixed = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD" as const;
    const r = await getTokenReport(8453, mixed);
    expect(r.facts.address).toBe(mixed.toLowerCase());
    expect(client.getCode).toHaveBeenCalledWith({ address: mixed.toLowerCase() });
    expect(TOKEN_REPORT_CACHE).toMatchObject({ revalidate: 600 });
    expect(cacheLife).toHaveBeenCalledWith(TOKEN_REPORT_CACHE);
    expect(cacheTag).toHaveBeenCalledWith(`checker-token:8453:${mixed.toLowerCase()}`);
  });

  it("does not cache a report with no ok section (timeouts and errors), but still returns it from a single analysis", async () => {
    client.getCode.mockRejectedValue(new TimeoutError({ body: {}, url: "https://rpc" }));
    routes = { blockscout: () => new Response("x", { status: 500 }), sourcify: timeout, dex: timeout };
    const r = await getTokenReport(8453, TOKEN);
    expect(r.facts.code).toEqual({ status: "unknown", reason: "timeout" });
    expect(r.facts.market).toEqual({ status: "unknown", reason: "timeout" });
    expect(client.getCode).toHaveBeenCalledTimes(1);
    expect(cacheLife).not.toHaveBeenCalled();
    expect(cacheTag).not.toHaveBeenCalled();
  });

  it("does not cache a report with no ok section whatever the reasons (blocked, rate limited, unsupported)", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    client.getCode.mockRejectedValue(new TimeoutError({ body: {}, url: "https://rpc" }));
    routes.blockscout = cloudflare;
    routes.sourcify = () => new Response("slow down", { status: 429 });
    const r = await getTokenReport(84532, TOKEN);
    expect(r.facts.verification).toEqual({ status: "unknown", reason: "blocked" });
    expect(r.facts.market).toEqual({ status: "unknown", reason: "unsupported" });
    expect(cacheLife).not.toHaveBeenCalled();
    expect(client.getCode).toHaveBeenCalledTimes(1);
  });

  it("caches a report as soon as one section answered, even with blocked sources (a valid state for 10 min)", async () => {
    routes.blockscout = cloudflare;
    routes.dex = timeout;
    await getTokenReport(8453, TOKEN);
    expect(cacheLife).toHaveBeenCalledWith(TOKEN_REPORT_CACHE);
  });
});
