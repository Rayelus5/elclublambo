import { describe, expect, it } from "vitest";
import { donutSlices } from "@/lib/treasury/charts";
import type { RankingEntry } from "@/lib/treasury/queries";

const rank = (n: number, bps: number, label = `@m${n}`): RankingEntry => ({
  rank: n,
  memberId: label === "Anónimo" || label === "Fondo del club" ? null : `id${n}`,
  label,
  shareBps: bps,
  netUsdc: 0n,
  club: label === "Fondo del club",
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

describe("donutSlices with the club fund", () => {
  it("labels the club fund «Fondo del club» (never by rank) with the neutral colour", () => {
    const slices = donutSlices([rank(1, 6000, "Fondo del club"), rank(2, 4000)]);
    expect(slices.map((s) => s.label)).toEqual(["Fondo del club", "@m2"]);
    expect(slices[0]!.color).toBe("var(--chart-rest)");
    expect(slices[1]!.color).toBe("var(--chart-1)");
  });

  it("keeps the club fund as its own slice even past the fifth place, and Resto then takes the muted colour", () => {
    const entries = [rank(1, 3000), rank(2, 2000), rank(3, 1500), rank(4, 1000), rank(5, 800), rank(6, 700), rank(7, 500, "Fondo del club"), rank(8, 499)];
    const slices = donutSlices(entries);
    expect(slices.map((s) => s.label)).toEqual(["@m1", "@m2", "@m3", "@m4", "@m5", "Fondo del club", "Resto"]);
    expect(slices.find((s) => s.label === "Fondo del club")!.bps).toBe(500);
    expect(slices.at(-1)!.bps).toBe(1200);
    expect(slices.at(-1)!.color).toBe("var(--fg-muted)");
    expect(slices.reduce((a, s) => a + s.bps, 0)).toBe(10000);
    expect(new Set(slices.map((s) => s.color)).size).toBe(slices.length);
  });
});
