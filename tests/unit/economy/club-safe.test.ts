import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const getCode = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: () => ({ getCode }) }));

let safeAddress: string | null = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
let dbError: unknown = null;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => (dbError ? { data: null, error: dbError } : { data: { safe_address: safeAddress }, error: null });
      return b;
    },
  }),
}));

import { donationChains, resetClubSafeCache, verifyClubSafe } from "@/lib/economy/club-safe";

beforeEach(() => {
  vi.clearAllMocks();
  resetClubSafeCache();
  safeAddress = "0x380f2e12081995359e2Ab88E3c31c6b227904234";
  dbError = null;
  vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("verifyClubSafe", () => {
  it("0x code is not_deployed", async () => {
    getCode.mockResolvedValue("0x");
    expect(await verifyClubSafe(84532)).toBe("not_deployed");
  });
  it("undefined code is not_deployed", async () => {
    getCode.mockResolvedValue(undefined);
    expect(await verifyClubSafe(84532)).toBe("not_deployed");
  });
  it("an EIP-7702 delegation designator is not_deployed", async () => {
    getCode.mockResolvedValue(`0xef0100${"ab".repeat(20)}`);
    expect(await verifyClubSafe(84532)).toBe("not_deployed");
  });
  it("bytecode is ok and cached: the second call does not call getCode", async () => {
    getCode.mockResolvedValue("0x6080604052");
    expect(await verifyClubSafe(84532)).toBe("ok");
    expect(await verifyClubSafe(84532)).toBe("ok");
    expect(getCode).toHaveBeenCalledTimes(1);
  });
  it("does not cache non-ok results", async () => {
    getCode.mockResolvedValue("0x");
    await verifyClubSafe(84532);
    await verifyClubSafe(84532);
    expect(getCode).toHaveBeenCalledTimes(2);
  });
  it("an RPC error is network", async () => {
    getCode.mockRejectedValue(new Error("down"));
    expect(await verifyClubSafe(84532)).toBe("network");
  });
  it("no safe_address is not_configured without calling the RPC", async () => {
    safeAddress = null;
    expect(await verifyClubSafe(84532)).toBe("not_configured");
    expect(getCode).not.toHaveBeenCalled();
  });
  it("a DB read error is network", async () => {
    dbError = { message: "boom" };
    expect(await verifyClubSafe(84532)).toBe("network");
  });
});

describe("donationChains", () => {
  it("lists the build chains whose Safe is ok", async () => {
    getCode.mockResolvedValue("0x6080");
    expect(await donationChains()).toEqual([84532, 421614]);
    getCode.mockResolvedValue("0x");
    resetClubSafeCache();
    expect(await donationChains()).toEqual([]);
  });
});
