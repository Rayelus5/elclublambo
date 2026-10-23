// @vitest-environment node
import { describe, expect, it } from "vitest";
// scripts/check-rpc.mjs still checks Linea until Task 3 moves it to Base and Arbitrum.
import { LEGACY_NETWORKS as NETWORKS } from "@/lib/legacy/linea";
import { CHAINS, checkRpc, loadLocalEnv, redactUrl, resolveChain, rpc } from "../../../scripts/check-rpc.mjs";

describe("loadLocalEnv", () => {
  it("loads .env.local then .env when present, in that order (existing vars are never overridden by loadEnvFile)", () => {
    const loaded: string[] = [];
    loadLocalEnv("/repo", (p: string) => p.endsWith(".env.local") || p.endsWith(".env"), (p: string) => loaded.push(p));
    expect(loaded.map((p) => p.replace(/\\/g, "/"))).toEqual(["/repo/.env.local", "/repo/.env"]);
  });
  it("skips missing files", () => {
    const loaded: string[] = [];
    loadLocalEnv("/repo", (p: string) => p.endsWith(".env"), (p: string) => loaded.push(p));
    expect(loaded.map((p) => p.replace(/\\/g, "/"))).toEqual(["/repo/.env"]);
  });
});

const URL_ = "https://linea-mainnet.infura.io/v3/SECRETKEY123";
type Handler = (params: unknown[]) => unknown;

/** Scripted JSON-RPC fetch: handlers return a result, or `{ error }` to answer a JSON-RPC error. */
function fakeFetch(handlers: Record<string, Handler>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const impl = async (_url: string, init: { body: string }) => {
    const { method, params, id } = JSON.parse(init.body);
    calls.push({ method, params });
    const h = handlers[method];
    if (!h) throw new Error(`unexpected ${method}`);
    const r = h(params) as { error?: unknown } | unknown;
    const body =
      r && typeof r === "object" && "error" in (r as object)
        ? { jsonrpc: "2.0", id, error: (r as { error: unknown }).error }
        : { jsonrpc: "2.0", id, result: r };
    return { ok: true, status: 200, json: async () => body };
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

const good = (latest = 5_000_000): Record<string, Handler> => ({
  eth_chainId: () => "0xe708",
  eth_blockNumber: () => "0x" + latest.toString(16),
  eth_call: () => "0x" + "0".repeat(64),
  eth_getLogs: () => [],
});

describe("resolveChain", () => {
  it("reads --chain first", () => {
    expect(resolveChain(["--chain", "59144"], { NEXT_PUBLIC_CHAIN: "lineaSepolia" })).toBe(59144);
  });
  it("falls back to NEXT_PUBLIC_CHAIN", () => {
    expect(resolveChain([], { NEXT_PUBLIC_CHAIN: "linea" })).toBe(59144);
    expect(resolveChain([], { NEXT_PUBLIC_CHAIN: "lineaSepolia" })).toBe(59141);
    expect(resolveChain([], {})).toBe(59141);
  });
  it("throws chain_invalid otherwise", () => {
    expect(() => resolveChain([], { NEXT_PUBLIC_CHAIN: "mainnet" })).toThrow("chain_invalid");
    expect(() => resolveChain(["--chain", "1"], {})).toThrow("chain_invalid");
  });
});

describe("redactUrl", () => {
  it("keeps only the origin", () => {
    expect(redactUrl(URL_)).toBe("https://linea-mainnet.infura.io/***");
    expect(redactUrl("https://u:p@x.io:8545/a?k=SECRETKEY123#h")).toBe("https://x.io:8545/***");
    expect(redactUrl("nope")).toBe("(invalid url)");
  });
});

describe("rpc", () => {
  it("throws method: code message without the URL", async () => {
    const { impl } = fakeFetch({ eth_call: () => ({ error: { code: -32000, message: "missing trie node" } }) });
    await expect(rpc(URL_, "eth_call", [], impl)).rejects.toThrow("eth_call: -32000 missing trie node");
  });
  it("throws on a non-2xx response", async () => {
    const impl = (async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(rpc(URL_, "eth_chainId", [], impl)).rejects.toThrow("eth_chainId: 429");
  });
});

describe("checkRpc", () => {
  it("all good gives 4 OK lines", async () => {
    const { impl } = fakeFetch(good());
    const r = await checkRpc(URL_, 59144, impl);
    expect(r.ok).toBe(true);
    expect(r.lines).toHaveLength(4);
    expect(r.lines.every((l: string) => l.startsWith("OK"))).toBe(true);
  });
  it("wrong chain id fails at step 1 and stops", async () => {
    const { impl, calls } = fakeFetch({ ...good(), eth_chainId: () => "0x1" });
    const r = await checkRpc(URL_, 59144, impl);
    expect(r.ok).toBe(false);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatch(/^FAIL/);
    expect(calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });
  it("archive failure", async () => {
    const { impl } = fakeFetch({
      ...good(),
      eth_call: () => ({ error: { code: -32000, message: "missing trie node" } }),
    });
    const r = await checkRpc(URL_, 59144, impl);
    expect(r.ok).toBe(false);
    expect(r.lines.at(-1)).toMatch(/^FAIL archive/);
    expect(r.lines.at(-1)).toContain("missing trie node");
  });
  it("getLogs range limit failure", async () => {
    const { impl } = fakeFetch({
      ...good(),
      eth_getLogs: () => ({ error: { code: -32005, message: "query exceeds max block range 1000" } }),
    });
    const r = await checkRpc(URL_, 59144, impl);
    expect(r.ok).toBe(false);
    expect(r.lines.at(-1)).toMatch(/^FAIL eth_getLogs/);
  });
  it("never prints the key, even from an exception", async () => {
    const impl = (async () => {
      throw new TypeError(`fetch failed: ${URL_}`);
    }) as unknown as typeof fetch;
    const r = await checkRpc(URL_, 59144, impl);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).not.toContain("SECRETKEY123");
  });
  it("never prints a key that appears bare in an error message", async () => {
    const { impl } = fakeFetch({
      ...good(),
      eth_blockNumber: () => ({ error: { code: -32000, message: "bad key SECRETKEY123 for /v3/SECRETKEY123" } }),
    });
    const r = await checkRpc(URL_, 59144, impl);
    expect(r.lines.join("\n")).not.toContain("SECRETKEY123");
  });
  it("clamps the archive block to 0x1 when latest = 500", async () => {
    const { impl, calls } = fakeFetch(good(500));
    await checkRpc(URL_, 59144, impl);
    const call = calls.find((c) => c.method === "eth_call")!;
    expect(call.params[1]).toBe("0x1");
    expect((call.params[0] as { to: string; data: string }).data).toBe("0x18160ddd");
  });
  it("probes the archive at latest - 1_000_000", async () => {
    const { impl, calls } = fakeFetch(good(5_000_000));
    await checkRpc(URL_, 59144, impl);
    expect(calls.find((c) => c.method === "eth_call")!.params[1]).toBe("0x" + (4_000_000).toString(16));
  });
  it("getLogs spans exactly 2001 blocks [latest-2100, latest-100]", async () => {
    const { impl, calls } = fakeFetch(good(5_000_000));
    await checkRpc(URL_, 59144, impl);
    const f = calls.find((c) => c.method === "eth_getLogs")!.params[0] as {
      fromBlock: string;
      toBlock: string;
      address: string;
      topics: (string | null)[];
    };
    const from = BigInt(f.fromBlock);
    const to = BigInt(f.toBlock);
    expect(to - from + 1n).toBe(2001n);
    expect(from).toBe(5_000_000n - 2100n);
    expect(to).toBe(5_000_000n - 100n);
    expect(f.address).toBe(CHAINS[59144].usdc);
    expect(f.topics[0]).toBe("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
    expect(f.topics[1]).toBeNull();
    expect(f.topics[2]).toBe("0x" + "0".repeat(63) + "1");
  });
});

describe("CHAINS", () => {
  it("matches NETWORKS", () => {
    for (const id of [59144, 59141] as const) {
      expect(CHAINS[id].usdc).toBe(NETWORKS[id].usdc);
    }
    expect(CHAINS[59144].rpcEnv).toBe("LINEA_RPC_URL");
    expect(CHAINS[59141].rpcEnv).toBe("LINEA_SEPOLIA_RPC_URL");
  });
});
