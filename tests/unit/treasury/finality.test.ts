import { beforeEach, describe, expect, it, vi } from "vitest";

const getBlock = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: () => ({ getBlock }) }));

import { finalityEta, formatEta } from "@/lib/treasury/eta";
import { FINALITY_CACHE_MS, finalityLagSeconds, finalitySnapshot, resetFinalityCache } from "@/lib/treasury/finality";

beforeEach(() => {
  getBlock.mockReset();
  resetFinalityCache();
  vi.useRealTimers();
});

describe("finalityLagSeconds", () => {
  it("is how far the finalized block's time trails now", async () => {
    getBlock.mockResolvedValue({ timestamp: 1_000n });
    expect(await finalityLagSeconds(59141, 1_000 + 3 * 3600)).toBe(3 * 3600);
    expect(getBlock).toHaveBeenCalledWith({ blockTag: "finalized" });
  });

  it("is null when the RPC fails (the page must still render)", async () => {
    getBlock.mockImplementation(() => Promise.reject(new Error("down")));
    expect(await finalityLagSeconds(59141, 5_000)).toBeNull();
  });
});

describe("finalitySnapshot (F5 S15: one RPC read per chain per minute, not per /dao render)", () => {
  it("reuses the lag per chain for FINALITY_CACHE_MS, counting the elapsed time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000_000 * 1000));
    getBlock.mockResolvedValue({ timestamp: 2_000_000n - 3600n });
    expect(await finalitySnapshot(59141)).toEqual({ lagSeconds: 3600, nowSeconds: 2_000_000 });
    vi.setSystemTime(new Date((2_000_000 + 30) * 1000));
    expect(await finalitySnapshot(59141)).toEqual({ lagSeconds: 3600, nowSeconds: 2_000_030 });
    expect(getBlock).toHaveBeenCalledTimes(1);
    await finalitySnapshot(59144); // another chain has its own entry
    expect(getBlock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date(2_000_000 * 1000 + FINALITY_CACHE_MS));
    await finalitySnapshot(59141);
    expect(getBlock).toHaveBeenCalledTimes(3);
  });

  it("also caches an unavailable RPC (null), so a failing node is not hammered on every render", async () => {
    getBlock.mockImplementation(() => Promise.reject(new Error("down")));
    expect((await finalitySnapshot(59141)).lagSeconds).toBeNull();
    expect((await finalitySnapshot(59141)).lagSeconds).toBeNull();
    expect(getBlock).toHaveBeenCalledTimes(1);
  });

  it("is about a minute", () => {
    expect(FINALITY_CACHE_MS).toBeGreaterThanOrEqual(30_000);
    expect(FINALITY_CACHE_MS).toBeLessThanOrEqual(120_000);
  });
});

describe("finalityEta", () => {
  it("expects a donation to finalize one lag after it was mined", () => {
    const now = 100_000;
    expect(finalityEta(now - 3600, 6 * 3600, now)).toBe(5 * 3600);
  });
  it("never goes below zero (overdue: any minute now)", () => {
    expect(finalityEta(0, 60, 100_000)).toBe(0);
  });
});

describe("formatEta", () => {
  it.each([
    [0, "en breve"],
    [10 * 60, "en unos minutos"],
    [50 * 60, "en ~1 h"],
    [5.6 * 3600, "en ~6 h"],
  ])("%s s -> %s", (s, text) => {
    expect(formatEta(s)).toBe(text);
  });
});
