import { beforeEach, describe, expect, it, vi } from "vitest";

const getBlock = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/chain-client", () => ({ chainClient: () => ({ getBlock }) }));

import { finalityEta, formatEta } from "@/lib/treasury/eta";
import { finalityLagSeconds } from "@/lib/treasury/finality";

beforeEach(() => {
  getBlock.mockReset();
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
