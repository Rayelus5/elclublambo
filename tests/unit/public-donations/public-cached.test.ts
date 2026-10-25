import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const cacheLife = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ cacheLife }));
const getSafeBalances = vi.hoisted(() => vi.fn());
vi.mock("@/lib/donations/safe-balances", () => ({ getSafeBalances }));
const getPublicDonationOverview = vi.hoisted(() => vi.fn());
vi.mock("@/lib/donations/public-queries", () => ({ getPublicDonationOverview }));

import { getCachedPublicDonationOverview, getCachedSafeBalances, PUBLIC_DONATE_CACHE } from "@/lib/donations/public-cached";

beforeEach(() => {
  cacheLife.mockReset();
  getSafeBalances.mockReset();
  getPublicDonationOverview.mockReset();
});

describe("public donate page caches", () => {
  it("keep a short life that stays out of the build prerender (expire under 5 minutes)", () => {
    expect(PUBLIC_DONATE_CACHE.revalidate).toBeLessThanOrEqual(60);
    expect(PUBLIC_DONATE_CACHE.expire).toBeLessThan(300);
    expect(PUBLIC_DONATE_CACHE.expire).toBeGreaterThan(PUBLIC_DONATE_CACHE.revalidate);
  });

  it("serve the Safe balances as text with the short cache life", async () => {
    getSafeBalances.mockResolvedValue([
      { chainId: 84532, usdc: 5_000_000n, eth: null },
      { chainId: 421614, usdc: null, eth: 10n ** 18n },
    ]);
    expect(await getCachedSafeBalances()).toEqual([
      { chainId: 84532, usdc: "5000000", eth: null },
      { chainId: 421614, usdc: null, eth: "1000000000000000000" },
    ]);
    expect(cacheLife).toHaveBeenCalledWith(PUBLIC_DONATE_CACHE);
  });

  it("serve the overview as text and let a failed read throw (nothing cached)", async () => {
    getPublicDonationOverview.mockResolvedValue({ totalUsd6: 12_500_000n, donationCount: 3 });
    expect(await getCachedPublicDonationOverview()).toEqual({ totalUsd6: "12500000", donationCount: 3 });
    expect(cacheLife).toHaveBeenCalledWith(PUBLIC_DONATE_CACHE);
    getPublicDonationOverview.mockRejectedValue(new Error("db down"));
    await expect(getCachedPublicDonationOverview()).rejects.toThrow("db down");
  });
});
