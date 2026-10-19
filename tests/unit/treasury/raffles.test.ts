import { describe, expect, it, vi } from "vitest";
import {
  formatPrize,
  getDaoRaffles,
  getRaffleDetail,
  getTreasuryRaffles,
  parsePrize,
  parseRaffleCard,
  raffleStatusLabel,
  type RaffleCard,
} from "@/lib/treasury/raffles";

const label = (over: Partial<Pick<RaffleCard, "status" | "payoutRecorded" | "unpaid" | "paidLate">>) =>
  raffleStatusLabel({ status: "open", payoutRecorded: false, unpaid: false, paidLate: false, ...over });

describe("raffleStatusLabel", () => {
  it("gives the nine exact labels", () => {
    expect(label({ status: "open" })).toBe("Abierto");
    expect(label({ status: "closed" })).toBe("Cerrado · esperando el bloque del sorteo");
    expect(label({ status: "drawn" })).toBe("Resuelto · pendiente de pago");
    expect(label({ status: "drawn", payoutRecorded: true })).toBe("Pago detectado · esperando finalidad");
    expect(label({ status: "drawn", unpaid: true })).toBe("Impagado · más de 14 días sin pagar");
    expect(label({ status: "paid" })).toBe("Pagado");
    expect(label({ status: "paid", paidLate: true })).toBe("Pagado con retraso");
    expect(label({ status: "cancelled" })).toBe("Cancelado");
    expect(label({ status: "void" })).toBe("Sin ganador");
  });
  it("a recorded payout wins over the unpaid flag (the payment is awaiting finality)", () => {
    expect(label({ status: "drawn", payoutRecorded: true, unpaid: true })).toBe("Pago detectado · esperando finalidad");
  });
});

describe("formatPrize / parsePrize", () => {
  it("formats with the token", () => {
    expect(formatPrize(10_000000n, "USDC")).toBe("10 USDC");
    expect(formatPrize(10n ** 16n, "WETH")).toBe("0,01 WETH");
    expect(formatPrize(1_500_250000n, "USDC")).toBe("1.500,25 USDC");
  });
  it("parses 6 decimals for USDC and 18 for WETH", () => {
    expect(parsePrize("0,001", "WETH")).toBe(10n ** 15n);
    expect(parsePrize("10", "USDC")).toBe(10_000000n);
    expect(parsePrize("1.5", "USDC")).toBe(1_500000n);
    expect(parsePrize("1,1234567", "USDC")).toBeNull();
    expect(parsePrize("0,0000000000000000001", "WETH")).toBeNull();
    for (const bad of ["", "abc", "-1", "1e3", "1,2,3"]) expect(parsePrize(bad, "USDC")).toBeNull();
  });
});

const rawCard = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  title: "Sorteo",
  prizeToken: "WETH",
  prizeAmount: "10000000000000000",
  mode: "weighted",
  closesAt: "2026-10-20T10:00:00+00:00",
  status: "closed",
  entries: 3,
  iEntered: true,
  myWeight: "2000000000000000000",
  totalWeight: "5000000000000000000",
  commit: `0x${"ab".repeat(32)}`,
  seedReveal: null,
  drawBlockNumber: null,
  winnerLabel: null,
  iWon: false,
  unpaid: false,
  paidLate: false,
  payoutRecorded: false,
  cancelReason: null,
  createdAt: "2026-10-19T10:00:00+00:00",
  ...over,
});

describe("parseRaffleCard", () => {
  it("turns amounts and weights into bigint", () => {
    const c = parseRaffleCard(rawCard())!;
    expect(c.prizeAmount).toBe(10n ** 16n);
    expect(c.myWeight).toBe(2n * 10n ** 18n);
    expect(c.totalWeight).toBe(5n * 10n ** 18n);
    expect(c.drawBlockNumber).toBeNull();
    expect(c).toMatchObject({ id: "r1", prizeToken: "WETH", mode: "weighted", status: "closed", entries: 3, iEntered: true });
  });
  it("keeps nulls (no entry, open raffle)", () => {
    const c = parseRaffleCard(rawCard({ status: "open", myWeight: null, totalWeight: null, iEntered: false }))!;
    expect(c.myWeight).toBeNull();
    expect(c.totalWeight).toBeNull();
  });
  it("parses the draw fields once drawn", () => {
    const c = parseRaffleCard(rawCard({ status: "drawn", drawBlockNumber: "12345", seedReveal: `0x${"cd".repeat(32)}`, winnerLabel: "Anónimo" }))!;
    expect(c.drawBlockNumber).toBe(12345n);
    expect(c.seedReveal).toBe(`0x${"cd".repeat(32)}`);
    expect(c.winnerLabel).toBe("Anónimo");
  });
  it("drops malformed rows", () => {
    expect(parseRaffleCard(null)).toBeNull();
    expect(parseRaffleCard(rawCard({ status: "weird" }))).toBeNull();
    expect(parseRaffleCard(rawCard({ prizeToken: "ETH" }))).toBeNull();
    expect(parseRaffleCard(rawCard({ id: 7 }))).toBeNull();
  });
});

const client = (replies: Record<string, { data?: unknown; error?: { message: string } | null }>) => {
  const rpc = vi.fn(async (name: string) => ({ data: replies[name]?.data ?? null, error: replies[name]?.error ?? null }));
  return { rpc, supabase: { rpc } as never };
};

describe("getDaoRaffles / getRaffleDetail / getTreasuryRaffles", () => {
  it("getDaoRaffles parses the list and passes the limit", async () => {
    const { rpc, supabase } = client({ dao_raffles: { data: [rawCard(), rawCard({ id: "r2", status: "nope" })] } });
    const list = await getDaoRaffles(supabase, 5);
    expect(rpc).toHaveBeenCalledWith("dao_raffles", { p_limit: 5 });
    expect(list.map((r) => r.id)).toEqual(["r1"]);
  });
  it("getDaoRaffles throws on an RPC error", async () => {
    const { supabase } = client({ dao_raffles: { error: { message: "forbidden" } } });
    await expect(getDaoRaffles(supabase)).rejects.toThrow("forbidden");
  });
  it("getRaffleDetail parses the draw inputs and the entry list; not_found is null", async () => {
    const detail = rawCard({
      status: "drawn",
      chainId: 59141,
      drawBlockNumber: "77",
      drawBlockHash: `0x${"ee".repeat(32)}`,
      drawBlockTime: "2026-10-20T10:00:02+00:00",
      drawParentBlockTime: "2026-10-20T09:59:59+00:00",
      drawRandom: "123456789012345678901234567890",
      winnerPosition: 2,
      payoutTxHash: null,
      entryList: [
        { position: 1, label: "Anónimo #1", weight: "3000000000000000000", isMe: false },
        { position: 2, label: "yo", weight: "2000000000000000000", isMe: true },
      ],
    });
    const { rpc, supabase } = client({ raffle_detail: { data: detail } });
    const d = (await getRaffleDetail(supabase, "r1"))!;
    expect(rpc).toHaveBeenCalledWith("raffle_detail", { p_raffle: "r1" });
    expect(d.chainId).toBe(59141);
    expect(d.drawRandom).toBe(123456789012345678901234567890n);
    expect(d.winnerPosition).toBe(2);
    expect(d.drawParentBlockTime).toBe("2026-10-20T09:59:59+00:00");
    expect(d.entryList).toEqual([
      { position: 1, label: "Anónimo #1", weight: 3n * 10n ** 18n, isMe: false },
      { position: 2, label: "yo", weight: 2n * 10n ** 18n, isMe: true },
    ]);
    const nf = client({ raffle_detail: { error: { message: "not_found" } } });
    expect(await getRaffleDetail(nf.supabase, "r1")).toBeNull();
    const bad = client({ raffle_detail: { error: { message: "forbidden" } } });
    await expect(getRaffleDetail(bad.supabase, "r1")).rejects.toThrow("forbidden");
  });
  it("an open raffle's entry list keeps null positions and weights", async () => {
    const { supabase } = client({
      raffle_detail: { data: rawCard({ status: "open", chainId: 59141, entryList: [{ position: null, label: "a", weight: null, isMe: false }] }) },
    });
    expect((await getRaffleDetail(supabase, "r1"))!.entryList).toEqual([{ position: null, label: "a", weight: null, isMe: false }]);
  });
  it("getTreasuryRaffles camel-cases the rows with bigint amounts", async () => {
    const row = {
      id: "r1", title: "T", status: "drawn", prize_token: "USDC", prize_amount: "5000000", prize_value_usd6: "5000000",
      mode: "equal", closes_at: "c", entries: 2, total_weight: "2", winner_member_id: "m1", winner_label: "Ana",
      winner_address: "0xabc", drawn_at: "d", unpaid: true, payout_tx_hash: null, payout_recorded_at: null, paid_at: null,
      cancel_reason: null, created_by_label: "Tesorero", created_at: "x",
    };
    const { rpc, supabase } = client({ treasury_raffles: { data: [row, { ...row, id: "r2", status: "bad" }] } });
    const list = await getTreasuryRaffles(supabase);
    expect(rpc).toHaveBeenCalledWith("treasury_raffles");
    expect(list).toEqual([
      {
        id: "r1", title: "T", status: "drawn", prizeToken: "USDC", prizeAmount: 5_000000n, prizeValueUsd6: 5_000000n,
        mode: "equal", closesAt: "c", entries: 2, totalWeight: 2n, winnerMemberId: "m1", winnerLabel: "Ana",
        winnerAddress: "0xabc", drawnAt: "d", unpaid: true, payoutTxHash: null, payoutRecordedAt: null, paidAt: null,
        cancelReason: null, createdByLabel: "Tesorero", createdAt: "x",
      },
    ]);
  });
});
