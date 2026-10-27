import { clubPath } from "@/lib/club/paths";
import { sparklineCoords, sparklineTone } from "@/components/market/sparkline";
import { formatChange, formatCompactUsd, formatPrice } from "@/lib/market/format";
import type { MarketCoin } from "@/lib/market/types";

/** At most this many points per 7-day sparkline in the list (CoinGecko sends 168 hourly ones; the line is 96 px wide). */
export const LIST_SPARKLINE_POINTS = 48;

export type MarketChange = ReturnType<typeof formatChange>;

/**
 * One row of the market list as plain data (T-006). The page sends the whole top 100 so «Ver más» reveals rows without
 * a request (T-005); as data it is a fraction of the rendered markup it replaced. Figures arrive formatted on the
 * server, so the client renders strings only (no Intl differences between server and browser).
 */
export type MarketRowData = {
  id: string;
  href: string;
  name: string;
  symbol: string;
  image: string | null;
  rank: number;
  price: string;
  change1h: MarketChange;
  change24h: MarketChange;
  change7d: MarketChange;
  marketCap: string;
  volume: string;
  spark: { coords: string; tone: string; label: string } | null;
};

function trendLabel(c: MarketCoin): string {
  const first = c.sparkline7d[0]!;
  const last = c.sparkline7d[c.sparkline7d.length - 1]!;
  return `Tendencia de 7 días de ${c.name}: ${last > first ? "sube" : last < first ? "baja" : "sin cambios"}`;
}

export function toMarketRowData(c: MarketCoin, index: number): MarketRowData {
  const coords = sparklineCoords(c.sparkline7d, LIST_SPARKLINE_POINTS);
  return {
    id: c.id,
    href: clubPath(`/mercado/${c.id}`),
    name: c.name,
    symbol: c.symbol,
    image: c.image,
    rank: c.rank ?? index + 1,
    price: formatPrice(c.priceUsd),
    change1h: formatChange(c.change1h),
    change24h: formatChange(c.change24h),
    change7d: formatChange(c.change7d),
    marketCap: formatCompactUsd(c.marketCapUsd),
    volume: formatCompactUsd(c.volumeUsd),
    spark: coords === null ? null : { coords, tone: sparklineTone(c.sparkline7d), label: trendLabel(c) },
  };
}
