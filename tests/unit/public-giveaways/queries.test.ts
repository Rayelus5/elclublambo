// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const adminRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: adminRpc }) }));
const userRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({ rpc: userRpc }) }));

import { getMyPublicGiveaways, getPublicGiveaway } from "@/lib/public-giveaways/queries";

const GID = "00000000-0000-4000-8000-000000000001";
const VIEWER = "00000000-0000-4000-8000-0000000000b1";

const raw = {
  id: GID, title: "T", description: null, hostName: null, hostAddress: "0xabc", closesAt: "2026-11-01T00:00:00Z", status: "drawn",
  targetRound: 123, seedCommit: "0xc", seedReveal: "0xr", drandSignature: "s", drandRandomness: "r", entryCount: 2, minTxCount: 3,
  hasAllowlist: true, isHost: true, iEntered: false, drawnAt: "2026-11-01T00:01:00Z", cancelledAt: null, createdAt: "2026-10-24T00:00:00Z",
  entries: [{ position: 1, walletAddress: "0xa" }, { position: 2, walletAddress: "0xb" }],
  prizes: [
    { id: "p1", rank: 1, kind: "crypto", chainId: 8453, token: "USDC", amount: "5000000", label: "5 USDC", status: "awarded", unawardedReason: null, winnerPosition: 2, winnerAddress: "0xb", payoutTxHash: null, paidAt: null, deliveredAt: null },
    { id: "p2", rank: 2, kind: "role", status: "awarded" },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe("getPublicGiveaway", () => {
  it("returns null for a non-UUID id without calling the database", async () => {
    expect(await getPublicGiveaway("nope", null)).toBeNull();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("maps the view, keeps amounts as strings and drops unknown prize kinds", async () => {
    adminRpc.mockResolvedValue({ data: raw, error: null });
    const v = await getPublicGiveaway(GID, VIEWER);
    expect(adminRpc).toHaveBeenCalledWith("public_giveaway_view", { p_id: GID, p_viewer: VIEWER });
    expect(v?.status).toBe("drawn");
    expect(v?.targetRound).toBe(123);
    expect(v?.entries).toEqual([{ position: 1, walletAddress: "0xa" }, { position: 2, walletAddress: "0xb" }]);
    expect(v?.prizes).toHaveLength(1);
    expect(v?.prizes[0]).toMatchObject({ id: "p1", amount: "5000000", chainId: 8453, winnerPosition: 2, winnerAddress: "0xb" });
    expect(v).toMatchObject({ isHost: true, hasAllowlist: true, minTxCount: 3 });
  });

  it("null when the giveaway does not exist or has an unknown status", async () => {
    adminRpc.mockResolvedValue({ data: null, error: null });
    expect(await getPublicGiveaway(GID, null)).toBeNull();
    adminRpc.mockResolvedValue({ data: { ...raw, status: "weird" }, error: null });
    expect(await getPublicGiveaway(GID, null)).toBeNull();
  });

  it("throws on a database error", async () => {
    adminRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    await expect(getPublicGiveaway(GID, null)).rejects.toThrow("public_giveaway_view");
  });
});

describe("getMyPublicGiveaways", () => {
  it("maps the cards with the user's client and the default limit", async () => {
    userRpc.mockResolvedValue({ data: [{ id: GID, title: "T", status: "open", closesAt: "c", entryCount: 4, prizeCount: 2 }, { id: "x", status: "bad" }], error: null });
    expect(await getMyPublicGiveaways()).toEqual([{ id: GID, title: "T", status: "open", closesAt: "c", entryCount: 4, prizeCount: 2 }]);
    expect(userRpc).toHaveBeenCalledWith("my_public_giveaways", { p_limit: 20 });
  });
});
