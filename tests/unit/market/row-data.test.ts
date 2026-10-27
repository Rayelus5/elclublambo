import { describe, expect, it } from "vitest";
import { toMarketRowData } from "@/lib/market/row-data";
import { sparklineCoords } from "@/components/market/sparkline";
import type { MarketCoin } from "@/lib/market/types";

// T-006: the Mercado page sends its top 100 as plain, pre-formatted data (one small object per coin) instead of 100
// rows of rendered markup; the client draws the rows it reveals. The 7-day sparkline (168 hourly points from CoinGecko)
// is reduced to what a 96 px line can show.
const week = Array.from({ length: 168 }, (_, i) => 60000 + 1000 * Math.sin(i / 10) + i * 10.5);
const btc: MarketCoin = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
  rank: 1,
  priceUsd: 64321.456,
  change1h: 0.1,
  change24h: 2.345,
  change7d: -3.2,
  marketCapUsd: 1.23e12,
  volumeUsd: 3e10,
  sparkline7d: week,
};

describe("toMarketRowData", () => {
  it("carries the figures already formatted, so the client formats nothing", () => {
    const row = toMarketRowData(btc, 0);
    expect(row).toMatchObject({
      id: "bitcoin",
      href: "/foro/mercado/bitcoin",
      name: "Bitcoin",
      symbol: "btc",
      rank: 1,
      price: "64.321,46 USD",
      change24h: { text: "+2,35 %", dir: "up" },
      change7d: { text: "-3,20 %", dir: "down" },
    });
    expect(row.marketCap).toMatch(/USD$/);
    expect(row.spark?.label).toBe("Tendencia de 7 días de Bitcoin: sube");
  });

  it("is plain serializable data and small", () => {
    const row = toMarketRowData(btc, 0);
    expect(JSON.parse(JSON.stringify(row))).toEqual(row);
    expect(JSON.stringify(row).length).toBeLessThan(1200);
  });

  it("falls back to the list position for a coin without a rank and has no sparkline under two points", () => {
    const row = toMarketRowData({ ...btc, rank: null, sparkline7d: [1] }, 4);
    expect(row.rank).toBe(5);
    expect(row.spark).toBeNull();
  });
});

describe("sparklineCoords", () => {
  it("downsamples to at most maxPoints, keeping the first and last values, with one decimal", () => {
    const coords = sparklineCoords(week, 48)!.split(" ");
    expect(coords).toHaveLength(48);
    for (const c of coords) expect(c).toMatch(/^\d+(\.\d)?,\d+(\.\d)?$/);
    const full = sparklineCoords(week)!.split(" ");
    expect(full).toHaveLength(168);
    expect(coords[0]).toBe(full[0]);
    expect(coords[47]).toBe(full[167]);
    expect(coords[0]!.startsWith("0.0,")).toBe(true);
    expect(coords[47]!.startsWith("100.0,")).toBe(true);
  });
});
