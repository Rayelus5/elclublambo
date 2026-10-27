import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<object>()), cache: <T,>(fn: T) => fn }));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc }) }));

import { getEconomyConfig } from "@/lib/economy/config";

const SAFE = "0x380f2e12081995359e2Ab88E3c31c6b227904234";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("getEconomyConfig", () => {
  it("keeps only the enabled chains of the build, in the build's order", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "testnet");
    rpc.mockResolvedValue({ data: { enabledChainIds: [421614, 8453, 84532] }, error: null });
    const cfg = await getEconomyConfig();
    expect(rpc).toHaveBeenCalledWith("economy_config");
    expect(cfg.enabledChainIds).toEqual([84532, 421614]);
  });

  it("drops Linea and junk ids; mainnet build keeps only mainnet chains", async () => {
    vi.stubEnv("NEXT_PUBLIC_NETWORK_SET", "mainnet");
    rpc.mockResolvedValue({ data: { enabledChainIds: [84532, 59141, "8453", 42161, 8453] }, error: null });
    expect((await getEconomyConfig()).enabledChainIds).toEqual([8453, 42161]);
  });

  it("reads the Safe per network and the legacy DAO flag (false unless exactly true)", async () => {
    rpc.mockResolvedValue({
      data: {
        enabledChainIds: [84532, 421614],
        networks: { "84532": { enabled: true, safe: SAFE }, "421614": { enabled: true, safe: null }, "8453": { enabled: true, safe: "" } },
        legacyDaoEnabled: "true",
      },
      error: null,
    });
    const cfg = await getEconomyConfig();
    expect(cfg.safes).toEqual({ 84532: SAFE });
    expect(cfg.legacyDaoEnabled).toBe(false);
    rpc.mockResolvedValue({ data: { legacyDaoEnabled: true }, error: null });
    const on = await getEconomyConfig();
    expect(on.legacyDaoEnabled).toBe(true);
    expect(on.enabledChainIds).toEqual([]);
    expect(on.safes).toEqual({});
  });

  it("keeps the legacy active chain and the per-network legacy switches (F4d)", async () => {
    rpc.mockResolvedValue({
      data: {
        activeChainId: 59144,
        chains: {
          "59141": { safe: "0xs", platform: null, withdrawalsEnabled: true, weightedRafflesEnabled: true },
          "59144": { safe: null, platform: "0xp", withdrawalsEnabled: false, weightedRafflesEnabled: "true" },
        },
      },
      error: null,
    });
    const { legacy } = await getEconomyConfig();
    expect(legacy.activeChainId).toBe(59144);
    expect(legacy.weightedRafflesEnabled).toEqual({ 59141: true, 59144: false });
    expect(legacy.withdrawalsEnabled).toEqual({ 59141: true, 59144: false });
    expect(legacy.chains).toEqual({ 59141: { safe: "0xs", platform: null }, 59144: { safe: null, platform: "0xp" } });
  });

  it("legacy switches are false and the active chain falls back to 59141 without data", async () => {
    rpc.mockResolvedValue({ data: { activeChainId: 8453 }, error: null });
    const { legacy } = await getEconomyConfig();
    expect(legacy.activeChainId).toBe(59141);
    expect(legacy.weightedRafflesEnabled).toEqual({ 59141: false, 59144: false });
  });

  it("has no minFeeBps", async () => {
    rpc.mockResolvedValue({ data: { minFeeBps: 100 }, error: null });
    expect(await getEconomyConfig()).not.toHaveProperty("minFeeBps");
  });
});
