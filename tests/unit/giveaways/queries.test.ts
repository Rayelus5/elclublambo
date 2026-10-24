import { describe, expect, it, vi } from "vitest";
import { getGiveaway, getGiveaways } from "@/lib/giveaways/queries";

const GID = "00000000-0000-4000-8000-000000000001";
const card = {
  id: GID,
  title: "Gran sorteo",
  closesAt: "2026-10-30T10:00:00+00:00",
  status: "drawn",
  entryCount: 7,
  iEntered: true,
  prizes: [
    { rank: 1, kind: "crypto", label: "5 USDC", chainId: 84532, amount: "5000000" },
    { rank: 2, kind: "custom", label: "Camiseta", chainId: null, amount: null },
  ],
  winners: [{ rank: 1, label: "@ana", iWon: false }],
};
type Client = Parameters<typeof getGiveaways>[0] & { rpc: ReturnType<typeof vi.fn> };
const client = (data: unknown, error: { message: string } | null = null) => ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as Client;

describe("getGiveaways", () => {
  it("parses the cards and passes the limit", async () => {
    const c = client([card, { ...card, id: "x", status: "weird", prizes: null, winners: undefined }]);
    const list = await getGiveaways(c, 10);
    expect(c.rpc).toHaveBeenCalledWith("giveaways_list", { p_limit: 10 });
    expect(list[0]).toEqual({
      id: GID,
      title: "Gran sorteo",
      closesAt: "2026-10-30T10:00:00+00:00",
      status: "drawn",
      entryCount: 7,
      iEntered: true,
      prizes: [
        { rank: 1, kind: "crypto", label: "5 USDC", chainId: 84532, amount: 5_000_000n },
        { rank: 2, kind: "custom", label: "Camiseta", chainId: null, amount: null },
      ],
      winners: [{ rank: 1, label: "@ana", iWon: false }],
    });
    // an unknown status from a newer schema is dropped rather than rendered wrong
    expect(list).toHaveLength(1);
  });
  it("throws on an RPC error", async () => {
    await expect(getGiveaways(client(null, { message: "forbidden" }), 10)).rejects.toThrow("forbidden");
  });
});

describe("getGiveaway", () => {
  const detail = {
    ...card,
    description: null,
    commit: `0x${"1".repeat(64)}`,
    seedReveal: `0x${"2".repeat(64)}`,
    targetRound: 1000,
    drandSignature: "ab".repeat(48),
    drandRandomness: "cd".repeat(32),
    drawnAt: "2026-10-30T11:00:00+00:00",
    cancelReason: null,
    entries: [
      { position: 1, label: "@ana", isMe: false },
      { position: null, label: "@luis", isMe: true },
    ],
    prizeStates: [
      {
        id: "p1", rank: 1, kind: "crypto", label: "5 USDC", chainId: 84532, token: "USDC", amount: "5000000", status: "awarded",
        unawardedReason: null, winnerPosition: 1, winnerLabel: "@ana", iWon: false, winnerAddress: "0xabc", payoutTxHash: null,
        paidAt: null, deliveredAt: null,
      },
      {
        id: "p2", rank: 2, kind: "custom", label: "Camiseta", chainId: null, token: null, amount: null, status: "unawarded",
        unawardedReason: "not_enough_entries", winnerPosition: null, winnerLabel: null, iWon: false, winnerAddress: null,
        payoutTxHash: null, paidAt: null, deliveredAt: null,
      },
      {
        id: "p3", rank: 3, kind: "custom", label: "Gorra", chainId: null, token: null, amount: null, status: "unawarded",
        unawardedReason: "winner_inactive", winnerPosition: 2, winnerLabel: "@luis", iWon: false, winnerAddress: null,
        payoutTxHash: null, paidAt: null, deliveredAt: null,
      },
    ],
  };

  it("parses the detail with the draw inputs, entries and prize states", async () => {
    const c = client(detail);
    const g = await getGiveaway(c, GID);
    expect(c.rpc).toHaveBeenCalledWith("giveaway_detail", { p_id: GID });
    expect(g).toMatchObject({
      id: GID,
      commit: detail.commit,
      seedReveal: detail.seedReveal,
      targetRound: 1000n,
      drandSignature: detail.drandSignature,
      drandRandomness: detail.drandRandomness,
      entries: detail.entries,
    });
    expect(g!.prizeStates[0]).toMatchObject({ id: "p1", amount: 5_000_000n, status: "awarded", winnerPosition: 1, winnerAddress: "0xabc" });
    expect(g!.prizeStates[1]).toMatchObject({ amount: null, unawardedReason: "not_enough_entries", winnerPosition: null });
    expect(g!.prizeStates[2]).toMatchObject({ status: "unawarded", unawardedReason: "winner_inactive", winnerPosition: 2 });
  });

  it("null for not_found or a malformed id; throws on other errors", async () => {
    expect(await getGiveaway(client(null, { message: "not_found" }), GID)).toBeNull();
    const c = client(detail);
    expect(await getGiveaway(c, "nope")).toBeNull();
    expect(c.rpc).not.toHaveBeenCalled();
    await expect(getGiveaway(client(null, { message: "forbidden" }), GID)).rejects.toThrow("forbidden");
  });
});
