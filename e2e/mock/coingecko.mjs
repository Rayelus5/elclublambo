// TEST-ONLY local mock of the three CoinGecko endpoints the Mercado pages read (src/lib/market/coingecko.ts), so the
// F4b e2e never touches the real API. Plain Node HTTP, no dependencies, deterministic fixtures.
// The app reaches it through COINGECKO_API_BASE (playwright.config.ts).
//   GET  /api/v3/coins/markets                  100 rows (see MARKETS below)
//   GET  /api/v3/coins/{bitcoin,longcoin}       coin detail
//   GET  /api/v3/coins/{bitcoin,longcoin}/market_chart  ?days=1|7|30|365
//   GET  /api/v3/coins/<anything else>[/...]    404
//   POST /__fail | /__ok                        every data endpoint answers 503 until /__ok
//   GET  /__health                              readiness (Playwright webServer url)
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

export const MOCK_PORT = 8549;

const IMG = "https://coin-images.coingecko.com/coins/images";
/** A coin name long enough to stress the 375 px layout (the "Cripto" cell must truncate, never widen the page). */
export const LONG_NAME = "Very Long Experimental Interoperability Governance Token Of The Decentralised Future";
/** A symbol with no break opportunity: must be truncated in the table and the coin header. */
export const LONG_SYMBOL = "verylongsymbolwithoutanyspaces";

/** A deterministic 7-day sparkline: 168 hourly points around `base`, trending by `trend` over the week. */
function sparkline(base, trend) {
  return Array.from({ length: 168 }, (_, i) => base * (1 + (trend * i) / 167 + 0.01 * Math.sin(i / 6)));
}

function row(i, over = {}) {
  const price = 1000 / (i + 1);
  return {
    id: `coin-${i}`,
    symbol: `c${i}`,
    name: `Coin ${i}`,
    image: null,
    current_price: price,
    market_cap: 1e9 / (i + 1),
    market_cap_rank: i,
    total_volume: 1e7 / (i + 1),
    price_change_percentage_1h_in_currency: 0.1,
    price_change_percentage_24h_in_currency: i % 2 === 0 ? 1.5 : -1.5,
    price_change_percentage_7d_in_currency: -3.2,
    sparkline_in_7d: { price: sparkline(price, i % 2 === 0 ? 0.05 : -0.05) },
    ...over,
  };
}

const MARKETS = Array.from({ length: 100 }, (_, k) => row(k + 1));
// Row 1: Bitcoin, with a valid CoinGecko image and a sparkline.
MARKETS[0] = row(1, {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: `${IMG}/1/large/bitcoin.png`,
  current_price: 67234.56,
  market_cap: 1.32e12,
  total_volume: 2.8e10,
  price_change_percentage_24h_in_currency: 2.34,
  sparkline_in_7d: { price: sparkline(65000, 0.03) },
});
// Row 2: no price and no sparkline (the row must still render, with "—").
MARKETS[1] = row(2, { id: "nullcoin", symbol: "nul", name: "Null Price Coin", current_price: null, sparkline_in_7d: undefined });
// Row 3: image on a foreign host (must not be rendered).
MARKETS[2] = row(3, { id: "foreigncoin", symbol: "frn", name: "Foreign Image Coin", image: "https://evil.example.com/x.png" });
// Row 4: a very long name and a very long symbol (both untrusted lengths).
MARKETS[3] = row(4, { id: "longcoin", symbol: LONG_SYMBOL, name: LONG_NAME });

const BITCOIN = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: { large: `${IMG}/1/large/bitcoin.png` },
  market_cap_rank: 1,
  links: { homepage: ["https://bitcoin.org"] },
  market_data: {
    current_price: { usd: 67234.56 },
    price_change_percentage_24h: 2.34,
    market_cap: { usd: 1.32e12 },
    total_volume: { usd: 2.8e10 },
    circulating_supply: 19700000,
    max_supply: 21000000,
    ath: { usd: 73750.07 },
    ath_date: { usd: "2024-03-14T07:10:36.635Z" },
  },
};

// The long-name coin also has a page (coin header at 375 px).
const LONGCOIN = {
  ...BITCOIN,
  id: "longcoin",
  symbol: LONG_SYMBOL,
  name: LONG_NAME,
  image: { large: null },
  market_cap_rank: 4,
  links: { homepage: [] },
};
const DETAILS = { bitcoin: BITCOIN, longcoin: LONGCOIN };

// Fixed timeline so every run draws the same chart.
const T_END = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY = 86_400_000;
function chart(days) {
  const n = days === 1 ? 288 : days === 7 ? 168 : days === 30 ? 720 : 365;
  const step = (days * DAY) / (n - 1);
  const start = 50000 + days * 10;
  return {
    prices: Array.from({ length: n }, (_, i) => [T_END - days * DAY + i * step, start + (i / (n - 1)) * 17000 + 300 * Math.sin(i / 9)]),
  };
}

let failing = false;

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

export function handle(req, res) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${MOCK_PORT}`);
  const path = url.pathname;
  if (path === "/__health") return send(res, 200, { ok: true, failing });
  if (req.method === "POST" && path === "/__fail") {
    failing = true;
    return send(res, 200, { failing });
  }
  if (req.method === "POST" && path === "/__ok") {
    failing = false;
    return send(res, 200, { failing });
  }
  if (req.method !== "GET" || !path.startsWith("/api/v3/")) return send(res, 404, { error: "not found" });
  if (failing) return send(res, 503, { error: "service unavailable" });

  if (path === "/api/v3/coins/markets") return send(res, 200, MARKETS);
  const coin = /^\/api\/v3\/coins\/([^/]+)(\/market_chart)?$/.exec(path);
  const detail = coin && Object.hasOwn(DETAILS, coin[1]) ? DETAILS[coin[1]] : null;
  if (detail && !coin[2]) return send(res, 200, detail);
  if (detail && coin[2]) {
    const days = Number(url.searchParams.get("days"));
    if (![1, 7, 30, 365].includes(days)) return send(res, 400, { error: "invalid days" });
    return send(res, 200, chart(days));
  }
  // Any other coin, like the real API.
  return send(res, 404, { error: "coin not found" });
}

// Started directly (`node e2e/mock/coingecko.mjs`): listen. Imported: only the handler is used.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer(handle).listen(MOCK_PORT, "127.0.0.1", () => console.log(`mock CoinGecko on http://127.0.0.1:${MOCK_PORT}`));
}
