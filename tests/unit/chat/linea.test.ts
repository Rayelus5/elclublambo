import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  getCode: vi.fn(),
  http: vi.fn((url?: string, opts?: unknown) => ({ url, opts })),
  createPublicClient: vi.fn(),
}));
vi.mock("viem", async (orig) => {
  const actual = await orig<typeof import("viem")>();
  h.createPublicClient.mockImplementation(() => ({ getCode: h.getCode }));
  return { ...actual, createPublicClient: h.createPublicClient, http: h.http };
});

import { verifyLineaContract } from "@/lib/chat/linea";

const ADDR = "0x1234567890abcdef1234567890ABCDEF12345678";

beforeEach(() => {
  h.getCode.mockReset();
  h.http.mockClear();
  h.createPublicClient.mockClear();
  delete process.env.LINEA_RPC_URL;
});

describe("verifyLineaContract", () => {
  it("returns false when there is no bytecode (0x or undefined)", async () => {
    h.getCode.mockResolvedValueOnce("0x");
    expect(await verifyLineaContract(ADDR)).toBe(false);
    h.getCode.mockResolvedValueOnce(undefined);
    expect(await verifyLineaContract(ADDR)).toBe(false);
  });

  it("returns true when the address has code", async () => {
    h.getCode.mockResolvedValue("0x6080604052");
    expect(await verifyLineaContract(ADDR)).toBe(true);
    expect(h.getCode).toHaveBeenCalledWith({ address: ADDR });
  });

  it("throws 'network' when the RPC fails", async () => {
    h.getCode.mockRejectedValue(new Error("fetch failed"));
    await expect(verifyLineaContract(ADDR)).rejects.toThrow("network");
  });

  it("uses LINEA_RPC_URL when set and the chain default otherwise", async () => {
    h.getCode.mockResolvedValue("0x00");
    await verifyLineaContract(ADDR);
    expect(h.http.mock.calls.at(-1)?.[0]).toBeUndefined();
    process.env.LINEA_RPC_URL = "https://rpc.example.test";
    await verifyLineaContract(ADDR);
    expect(h.http.mock.calls.at(-1)?.[0]).toBe("https://rpc.example.test");
    const chain = (h.createPublicClient.mock.calls.at(-1)?.[0] as { chain: { id: number } }).chain;
    expect(chain.id).toBe(59144);
  });

  it("rejects malformed addresses without calling the RPC", async () => {
    await expect(verifyLineaContract("0xabc")).resolves.toBe(false);
    expect(h.getCode).not.toHaveBeenCalled();
  });
});
