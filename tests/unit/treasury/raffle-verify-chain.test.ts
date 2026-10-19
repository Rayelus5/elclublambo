import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => vi.fn((url?: string) => ({ url })));
const getBlock = vi.hoisted(() => vi.fn());
const createPublicClient = vi.hoisted(() => vi.fn(() => ({ getBlock })));
vi.mock("viem", async (orig) => ({ ...(await orig<object>()), http, createPublicClient }));

import { fetchDrawBlocks } from "@/lib/treasury/raffle-verify-chain";

const HASH = `0x${"ab".repeat(32)}`;

beforeEach(() => {
  http.mockClear();
  getBlock.mockReset();
  getBlock.mockImplementation(async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: HASH, timestamp: 100n + blockNumber }));
});
afterEach(() => vi.unstubAllEnvs());

describe("fetchDrawBlocks", () => {
  it("uses the public override for Linea Sepolia when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL", "http://127.0.0.1:8545");
    await fetchDrawBlocks(59141, 5n);
    expect(http.mock.calls[0]![0]).toBe("http://127.0.0.1:8545");
  });

  it("uses the public override for Linea mainnet when set", async () => {
    vi.stubEnv("NEXT_PUBLIC_LINEA_RPC_URL", "https://rpc.example");
    await fetchDrawBlocks(59144, 5n);
    expect(http.mock.calls[0]![0]).toBe("https://rpc.example");
  });

  it("falls back to viem's default when the override is empty, and never reads the server variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL", "");
    vi.stubEnv("LINEA_SEPOLIA_RPC_URL", "https://private.example/key");
    await fetchDrawBlocks(59141, 5n);
    expect(http.mock.calls[0]![0]).toBeUndefined();
  });

  it("returns the block and its parent's time", async () => {
    const r = await fetchDrawBlocks(59141, 5n);
    expect(r).toEqual({ hash: HASH, timestamp: 105n, parentTimestamp: 104n });
  });

  it("returns null for a block that does not exist, and throws on transport errors", async () => {
    const { BlockNotFoundError } = await import("viem");
    getBlock.mockRejectedValue(new BlockNotFoundError({ blockNumber: 5n }));
    expect(await fetchDrawBlocks(59141, 5n)).toBeNull();
    getBlock.mockRejectedValue(new Error("429"));
    await expect(fetchDrawBlocks(59141, 5n)).rejects.toThrow("429");
  });
});
