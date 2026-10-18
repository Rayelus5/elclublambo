/** Market data is display-only (never feeds money logic), so plain JS numbers are fine here. */
export type MarketCoin = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  priceUsd: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  sparkline7d: number[];
};

export type CoinDetail = {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  priceUsd: number | null;
  change24h: number | null;
  marketCapUsd: number | null;
  volumeUsd: number | null;
  circulatingSupply: number | null;
  maxSupply: number | null;
  athUsd: number | null;
  athDate: string | null;
  homepage: string | null;
};

export type ChartRange = "1" | "7" | "30" | "365";
export const CHART_RANGES: readonly ChartRange[] = ["1", "7", "30", "365"];

export type ChartPoint = [timeMs: number, priceUsd: number];

export type Cached<T> = { data: T; fetchedAt: string; stale: boolean };

/** CoinGecko failed (network, timeout, 429/5xx, malformed body) and there is no usable copy. */
export class MarketUnavailableError extends Error {
  constructor(message = "market_unavailable") {
    super(message);
    this.name = "MarketUnavailableError";
  }
}

/** The coin id is invalid or unknown to CoinGecko. */
export class CoinNotFoundError extends Error {
  constructor(message = "coin_not_found") {
    super(message);
    this.name = "CoinNotFoundError";
  }
}
