import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ getCode: vi.fn(), chainClient: vi.fn() }));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: h.chainClient }));

import { verifyContract } from "@/lib/chat/contract";

const ADDR = "0x1234567890abcdef1234567890ABCDEF12345678" as const;

beforeEach(() => {
  h.getCode.mockReset();
  h.chainClient.mockReset();
  h.chainClient.mockImplementation(() => ({ getCode: h.getCode }));
});

describe("verifyContract", () => {
  it("returns false when there is no bytecode (0x or undefined)", async () => {
    h.getCode.mockResolvedValueOnce("0x");
    expect(await verifyContract(84532, ADDR)).toBe(false);
    h.getCode.mockResolvedValueOnce(undefined);
    expect(await verifyContract(84532, ADDR)).toBe(false);
  });

  it("returns true when the address has code, asking the client of that chain", async () => {
    h.getCode.mockResolvedValue("0x6080604052");
    expect(await verifyContract(42161, ADDR)).toBe(true);
    expect(h.chainClient).toHaveBeenCalledWith(42161);
    expect(h.getCode).toHaveBeenCalledWith({ address: ADDR });
  });

  it("treats an EIP-7702 delegated EOA (0xef0100 designator) as not a contract", async () => {
    h.getCode.mockResolvedValueOnce("0xef0100" + "ab".repeat(20));
    expect(await verifyContract(8453, ADDR)).toBe(false);
    h.getCode.mockResolvedValueOnce("0xEF0100" + "AB".repeat(20));
    expect(await verifyContract(8453, ADDR)).toBe(false);
  });

  it("throws 'network' when the RPC fails", async () => {
    h.getCode.mockRejectedValue(new Error("fetch failed"));
    await expect(verifyContract(84532, ADDR)).rejects.toThrow("network");
  });
});
