import { describe, expect, it, vi } from "vitest";
import { getDonationOverview, getDonorRanking, getMyDonorStatus } from "@/lib/donations/queries";

const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })), from: vi.fn() }) as never;

describe("donation queries", () => {
  it("parses the overview text amounts to bigint", async () => {
    const c = client({
      totalUsd6: "12345678901234567890",
      donorCount: 3,
      byChain: [{ chainId: 8453, usd6: "5000000" }],
      recent: [{ id: "d1", at: "2026-10-24T00:00:00Z", chainId: 8453, token: "ETH", amount: "1000000000000000000", usd6: "2360456469", donorLabel: null }],
    });
    expect(await getDonationOverview(c)).toEqual({
      totalUsd6: 12345678901234567890n,
      donorCount: 3,
      byChain: [{ chainId: 8453, usd6: 5000000n }],
      recent: [{ id: "d1", at: "2026-10-24T00:00:00Z", chainId: 8453, token: "ETH", amount: 10n ** 18n, usd6: 2360456469n, donorLabel: null }],
    });
  });
  it("overview throws on RPC error", async () => {
    await expect(getDonationOverview(client(null, { message: "x" }))).rejects.toThrow("x");
  });
  it("parses the ranking", async () => {
    const c = client([{ member_id: "m1", label: "ana", total_usd6: "7000000", is_me: true }]);
    expect(await getDonorRanking(c, 10)).toEqual([{ memberId: "m1", label: "ana", totalUsd6: 7000000n, isMe: true }]);
    expect((c as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith("donor_ranking", { p_limit: 10 });
  });
  it("parses my status", async () => {
    expect(await getMyDonorStatus(client({ totalUsd6: "1000000", isMecenas: true, visible: false }))).toEqual({
      totalUsd6: 1000000n,
      isMecenas: true,
      visible: false,
    });
  });
});
