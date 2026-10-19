import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<object>()), cache: <T,>(fn: T) => fn }));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));

import { getEconomyConfig } from "@/lib/economy/config";

beforeEach(() => vi.clearAllMocks());

describe("getEconomyConfig", () => {
  it("reads the per-network weighted raffles switch (F4d), false unless exactly true", async () => {
    rpc.mockResolvedValue({
      data: {
        activeChainId: 59141,
        minFeeBps: 100,
        chains: {
          "59141": { safe: "0xs", platform: null, withdrawalsEnabled: true, weightedRafflesEnabled: true },
          "59144": { safe: null, platform: null, withdrawalsEnabled: false, weightedRafflesEnabled: "true" },
        },
      },
      error: null,
    });
    const cfg = await getEconomyConfig();
    expect(rpc).toHaveBeenCalledWith("economy_config");
    expect(cfg.weightedRafflesEnabled).toEqual({ 59141: true, 59144: false });
    expect(cfg.withdrawalsEnabled).toEqual({ 59141: true, 59144: false });
  });
  it("is false for both networks when the payload has no chains", async () => {
    rpc.mockResolvedValue({ data: { activeChainId: 59144 }, error: null });
    expect((await getEconomyConfig()).weightedRafflesEnabled).toEqual({ 59141: false, 59144: false });
  });
});
