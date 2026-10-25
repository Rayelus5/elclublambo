import { beforeEach, describe, expect, it, vi } from "vitest";
import { zeroAddress, zeroHash, type PublicClient } from "viem";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: vi.fn() }));

import { cacheLife } from "next/cache";
import { chainClient } from "@/lib/payments/chain-client";
import { VOUCH_SCHEMA_UID } from "@/lib/vouches/eas";
import { getVouchSchemaRegistered } from "@/lib/vouches/verify";

const CHAIN = 84532 as const;

function client(read: () => Promise<unknown>) {
  vi.mocked(chainClient).mockReturnValue({ readContract: vi.fn(read) } as unknown as PublicClient);
}

beforeEach(() => vi.clearAllMocks());

describe("getVouchSchemaRegistered (P5-R3 cache lifetimes)", () => {
  it("keeps a registered schema for hours", async () => {
    client(async () => ({ uid: VOUCH_SCHEMA_UID, resolver: zeroAddress, revocable: true, schema: "uint8 kind" }));
    await expect(getVouchSchemaRegistered(CHAIN)).resolves.toBe(true);
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("hours");
  });
  it("keeps an unregistered schema only for seconds", async () => {
    client(async () => ({ uid: zeroHash, resolver: zeroAddress, revocable: false, schema: "" }));
    await expect(getVouchSchemaRegistered(CHAIN)).resolves.toBe(false);
    expect(cacheLife).toHaveBeenCalledExactlyOnceWith("seconds");
  });
  it("throws on an RPC failure without setting a lifetime", async () => {
    client(async () => {
      throw new Error("rpc down");
    });
    await expect(getVouchSchemaRegistered(CHAIN)).rejects.toThrow("rpc down");
    expect(cacheLife).not.toHaveBeenCalled();
  });
});
