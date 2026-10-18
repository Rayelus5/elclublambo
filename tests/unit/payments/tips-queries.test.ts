import { describe, expect, it, vi } from "vitest";
import { donorLabel, getMemberTipTotals, getMemberTips, getMessageTips, getTipNoticeLinks, getTipSummaries } from "@/lib/payments/queries";

const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const DONOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HASH = `0x${"ab".repeat(32)}`;

function client(rpcs: Record<string, unknown>, members: unknown[] = []) {
  return {
    rpc: vi.fn(async (name: string) => ({ data: rpcs[name] ?? [], error: null })),
    from: vi.fn(() => ({ select: () => ({ in: async () => ({ data: members, error: null }) }) })),
  };
}

describe("getTipSummaries", () => {
  it("groups by message, orders USDC before ETH and reads the exact text total", async () => {
    const supabase = client({
      tips_summary: [
        { message_id: M1, token: "ETH", total: 1e15, tip_count: 1, total_text: "1000000000000000" },
        { message_id: M1, token: "USDC", total: 12500000, tip_count: 2, total_text: "12500000" },
        { message_id: M2, token: "ETH", total: 1.2345678901234568e19, tip_count: 1, total_text: "12345678901234567890" },
      ],
    });
    const map = (await getTipSummaries(supabase as never, [M1, M2]))!;
    expect(map.get(M1)).toEqual([
      { token: "USDC", total: 12_500_000n, count: 2 },
      { token: "ETH", total: 1_000_000_000_000_000n, count: 1 },
    ]);
    expect(map.get(M2)![0]!.total).toBe(12_345_678_901_234_567_890n);
  });

  it("does not call the database for no ids and swallows failures", async () => {
    const supabase = client({});
    expect((await getTipSummaries(supabase as never, []))?.size).toBe(0);
    expect(supabase.rpc).not.toHaveBeenCalled();
    const broken = { rpc: vi.fn(async () => ({ data: null, error: { message: "x" } })) };
    expect(await getTipSummaries(broken as never, [M1])).toBeNull();
  });
});

describe("tip entries", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    tip_id: "t1",
    donor_id: DONOR,
    is_me: false,
    anonymous: false,
    token: "USDC",
    amount: 5,
    amount_text: "5000000",
    chain_id: 59141,
    main_tx_hash: HASH,
    created_at: "2026-10-18T10:00:00Z",
    ...over,
  });
  const donor = { id: DONOR, handle: "dona", display_name: "Dona", wallet_address: "0x2222222222222222222222222222222222222222", avatar_path: null };

  it("resolves the donor name and reads exact amounts", async () => {
    const supabase = client({ message_tips: [row()] }, [donor]);
    const [e] = await getMessageTips(supabase as never, M1);
    expect(e).toMatchObject({ tipId: "t1", donorName: "Dona", isMe: false, anonymous: false, token: "USDC", amount: 5_000_000n, chainId: 59141, txHash: HASH });
    expect(donorLabel(e!)).toBe("Dona");
  });

  it("keeps a hidden hash as null", async () => {
    const supabase = client({ message_tips: [row({ donor_id: null, anonymous: true, main_tx_hash: null })] });
    const [e] = await getMessageTips(supabase as never, M1);
    expect(e!.txHash).toBeNull();
  });

  it("labels anonymous tips without ever naming the donor", async () => {
    const supabase = client(
      { member_tips: [row({ donor_id: null, anonymous: true }), row({ tip_id: "t2", is_me: true, anonymous: true }), row({ tip_id: "t3", is_me: true })] },
      [donor],
    );
    const entries = await getMemberTips(supabase as never, M1);
    expect(entries.map(donorLabel)).toEqual(["Anónimo", "Tú (anónimo)", "Tú"]);
    expect(entries[0]!.donorName).toBeNull();
  });

  it("flags tips whose message was deleted (M3), never for the message popover rows", async () => {
    const supabase = client({ member_tips: [row({ message_deleted: true }), row({ tip_id: "t2", message_deleted: false }), row({ tip_id: "t3" })] }, [donor]);
    const entries = await getMemberTips(supabase as never, M1);
    expect(entries.map((e) => e.messageDeleted)).toEqual([true, false, false]);
  });
});

describe("getTipNoticeLinks", () => {
  it("maps tip ids to chain and hash", async () => {
    const supabase = client({ tips_by_ids: [{ tip_id: "t1", chain_id: 59144, main_tx_hash: HASH }] });
    const map = await getTipNoticeLinks(supabase as never, ["t1"]);
    expect(map.get("t1")).toEqual({ chainId: 59144, txHash: HASH });
  });

  it("skips a tip whose hash is hidden (someone else's anonymous tip)", async () => {
    const supabase = client({ tips_by_ids: [{ tip_id: "t1", chain_id: 59144, main_tx_hash: null }] });
    const map = await getTipNoticeLinks(supabase as never, ["t1"]);
    expect(map.has("t1")).toBe(false);
  });
});

describe("getMemberTipTotals", () => {
  it("reads the server-side totals for the chain, USDC then ETH, exact", async () => {
    const supabase = client({
      member_tips_totals: [
        { token: "ETH", total_text: "12345678901234567890", tip_count: 1 },
        { token: "USDC", total_text: "155000000", tip_count: 151 },
      ],
    });
    const totals = await getMemberTipTotals(supabase as never, M1, 59141);
    expect(totals).toEqual([
      { token: "USDC", total: 155_000_000n, count: 151 },
      { token: "ETH", total: 12_345_678_901_234_567_890n, count: 1 },
    ]);
    expect(supabase.rpc).toHaveBeenCalledWith("member_tips_totals", { p_member: M1, p_chain: 59141 });
  });
});
