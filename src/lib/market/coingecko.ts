import "server-only";
import {
  CHART_RANGES,
  COIN_ID_RE,
  CoinNotFoundError,
  MarketUnavailableError,
  type ChartPoint,
  type ChartRange,
  type CoinDetail,
  type MarketCoin,
} from "@/lib/market/types";

// Display-only data. COINGECKO_API_BASE is honoured in every environment (ruling F4b-R1).
// Deliberately independent from src/lib/treasury/valuation.ts.
const DEFAULT_BASE = "https://api.coingecko.com/api/v3";
const TIMEOUT_MS = 5000;
const IMAGE_HOSTS = new Set(["coin-images.coingecko.com", "assets.coingecko.com"]);

export function isCoinId(id: string): boolean {
  return typeof id === "string" && COIN_ID_RE.test(id);
}

function base(): string {
  return (process.env.COINGECKO_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function safeImage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && IMAGE_HOSTS.has(u.hostname) && !u.username && !u.password && !u.port ? v : null;
  } catch {
    return null;
  }
}

function safeHttps(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/** GET + parse JSON. 404 -> CoinNotFoundError; anything else wrong -> MarketUnavailableError. */
async function getJson(path: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: "application/json" };
  const key = process.env.COINGECKO_API_KEY;
  if (key) headers["x-cg-demo-api-key"] = key;
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new MarketUnavailableError("network");
  }
  if (res.status === 404) throw new CoinNotFoundError();
  if (!res.ok) throw new MarketUnavailableError(`http_${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new MarketUnavailableError("malformed_json");
  }
}

export async function fetchTopMarkets(): Promise<MarketCoin[]> {
  let body: unknown;
  try {
    body = await getJson(
      "/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h%2C24h%2C7d",
    );
  } catch (e) {
    // A 404 on the list endpoint is not "unknown coin".
    if (e instanceof CoinNotFoundError) throw new MarketUnavailableError("http_404");
    throw e;
  }
  if (!Array.isArray(body)) throw new MarketUnavailableError("malformed_body");
  const out: MarketCoin[] = [];
  const seen = new Set<string>();
  for (const r of body) {
    if (!isObj(r)) continue;
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name || !isCoinId(id) || seen.has(id)) continue;
    seen.add(id);
    const spark = isObj(r.sparkline_in_7d) && Array.isArray(r.sparkline_in_7d.price) ? r.sparkline_in_7d.price : [];
    out.push({
      id,
      symbol: str(r.symbol) ?? "",
      name,
      image: safeImage(r.image),
      rank: num(r.market_cap_rank),
      priceUsd: num(r.current_price),
      change1h: num(r.price_change_percentage_1h_in_currency),
      change24h: num(r.price_change_percentage_24h_in_currency),
      change7d: num(r.price_change_percentage_7d_in_currency),
      marketCapUsd: num(r.market_cap),
      volumeUsd: num(r.total_volume),
      sparkline7d: spark.filter((p): p is number => num(p) !== null),
    });
  }
  return out;
}

export async function fetchCoin(id: string): Promise<CoinDetail> {
  if (!isCoinId(id)) throw new CoinNotFoundError();
  const body = await getJson(
    `/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`,
  );
  if (!isObj(body)) throw new MarketUnavailableError("malformed_body");
  const rid = str(body.id);
  const name = str(body.name);
  if (!rid || !name || rid !== id) throw new MarketUnavailableError("malformed_body");
  const md = isObj(body.market_data) ? body.market_data : {};
  const usd = (v: unknown) => (isObj(v) ? num(v.usd) : null);
  const links = isObj(body.links) ? body.links : {};
  const homepage = Array.isArray(links.homepage) ? safeHttps(links.homepage[0]) : null;
  const athDate = isObj(md.ath_date) ? str(md.ath_date.usd) : null;
  return {
    id: rid,
    symbol: str(body.symbol) ?? "",
    name,
    image: isObj(body.image) ? safeImage(body.image.large) : null,
    rank: num(body.market_cap_rank),
    priceUsd: usd(md.current_price),
    change24h: num(md.price_change_percentage_24h),
    marketCapUsd: usd(md.market_cap),
    volumeUsd: usd(md.total_volume),
    circulatingSupply: num(md.circulating_supply),
    maxSupply: num(md.max_supply),
    athUsd: usd(md.ath),
    athDate: athDate && !Number.isNaN(Date.parse(athDate)) ? athDate : null,
    homepage,
  };
}

export async function fetchChart(id: string, range: ChartRange): Promise<ChartPoint[]> {
  if (!isCoinId(id)) throw new CoinNotFoundError();
  if (!CHART_RANGES.includes(range)) throw new CoinNotFoundError();
  const body = await getJson(`/coins/${id}/market_chart?vs_currency=usd&days=${range}`);
  if (!isObj(body) || !Array.isArray(body.prices)) throw new MarketUnavailableError("malformed_body");
  const pts: ChartPoint[] = [];
  for (const p of body.prices) {
    if (Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null) pts.push([p[0] as number, p[1] as number]);
  }
  return pts;
}
