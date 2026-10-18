import { describe, expect, it } from "vitest";
import { balanceSeries, donutSlices } from "@/lib/treasury/charts";
import type { HistoryEntry, RankingEntry } from "@/lib/treasury/queries";

const rank = (n: number, bps: number, label = `@m${n}`): RankingEntry => ({
  rank: n,
  memberId: label === "Anónimo" ? null : `id${n}`,
  label,
  shareBps: bps,
  netUsdc: 0n,
});

const hist = (iso: string, amount: bigint): HistoryEntry => ({
  ledgerId: iso,
  memberId: null,
  label: "Anónimo",
  amount,
  txHash: null,
  creditedAt: iso,
});

describe("donutSlices", () => {
  it("is empty without donors", () => {
    expect(donutSlices([])).toEqual([]);
  });

  it("keeps up to five members and groups the rest, largest first, summing to 100 %", () => {
    const entries = [rank(1, 4000), rank(2, 2000), rank(3, 1500), rank(4, 1000), rank(5, 800), rank(6, 400), rank(7, 300)];
    const slices = donutSlices(entries);
    expect(slices.map((s) => s.label)).toEqual(["@m1", "@m2", "@m3", "@m4", "@m5", "Resto"]);
    expect(slices.at(-1)!.bps).toBe(700);
    expect(slices.reduce((a, s) => a + s.bps, 0)).toBe(10000);
  });

  it("gives the floor-division remainder to Resto and labels anonymous donors by rank", () => {
    const slices = donutSlices([rank(1, 6666, "Anónimo"), rank(2, 3333)]);
    expect(slices.map((s) => s.label)).toEqual(["#1 Anónimo", "@m2", "Resto"]);
    expect(slices.at(-1)!.bps).toBe(1);
  });

  it("omits Resto when nothing is left", () => {
    expect(donutSlices([rank(1, 10000)]).map((s) => s.label)).toEqual(["@m1"]);
  });

  it("assigns each slice a distinct colour token, Resto the neutral one", () => {
    const slices = donutSlices([rank(1, 5000), rank(2, 4000), rank(3, 500)]);
    expect(new Set(slices.map((s) => s.color)).size).toBe(slices.length);
    expect(slices.at(-1)!.color).toBe("var(--chart-rest)");
  });
});

describe("balanceSeries", () => {
  it("has no points without history", () => {
    expect(balanceSeries([], 0n)).toEqual([]);
  });

  it("walks back from the current balance: starts at what was there before the oldest shown credit", () => {
    // newest first, as dao_history returns it; only the last 2 of 3 credits are shown
    const points = balanceSeries([hist("2026-10-18T12:00:00Z", 5_000_000n), hist("2026-10-17T12:00:00Z", 10_000_000n)], 20_000_000n);
    expect(points.map((p) => p.usdc)).toEqual([5, 15, 20]);
    expect(points[0]!.at).toBe("2026-10-17T12:00:00Z");
    expect(points.at(-1)!.at).toBe("2026-10-18T12:00:00Z");
  });

  it("never goes below zero if the ledger and the shown history disagree", () => {
    expect(balanceSeries([hist("2026-10-18T12:00:00Z", 9_000_000n)], 1_000_000n)[0]!.usdc).toBe(0);
  });
});
