import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoinNotFoundError, MarketUnavailableError } from "@/lib/market/types";
import { fetchChart, fetchCoin, fetchTopMarkets, isCoinId } from "@/lib/market/coingecko";

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  vi.stubEnv("COINGECKO_API_BASE", "");
  vi.stubEnv("COINGECKO_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isCoinId", () => {
  it("accepts slugs", () => {
    for (const id of ["bitcoin", "usd-coin", "wrapped-steth"]) expect(isCoinId(id)).toBe(true);
  });
  it("rejects anything else", () => {
    for (const id of ["", "Bitcoin", "../x", "a/b", "a".repeat(65)]) expect(isCoinId(id)).toBe(false);
    expect(isCoinId("a".repeat(64))).toBe(true);
  });
});

const row = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
  current_price: 65000.5,
  market_cap: 1.2e12,
  market_cap_rank: 1,
  total_volume: 3e10,
  price_change_percentage_1h_in_currency: 0.1,
  price_change_percentage_24h_in_currency: -2.5,
  price_change_percentage_7d_in_currency: 4,
  sparkline_in_7d: { price: [1, 2, 3] },
};

describe("fetchTopMarkets", () => {
  it("calls the default endpoint without a key header and maps rows", async () => {
    fetchMock.mockResolvedValue(json([row]));
    const coins = await fetchTopMarkets();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=true&price_change_percentage=1h%2C24h%2C7d",
    );
    expect(init.headers["x-cg-demo-api-key"]).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(coins).toEqual([
      {
        id: "bitcoin",
        symbol: "btc",
        name: "Bitcoin",
        image: row.image,
        rank: 1,
        priceUsd: 65000.5,
        change1h: 0.1,
        change24h: -2.5,
        change7d: 4,
        marketCapUsd: 1.2e12,
        volumeUsd: 3e10,
        sparkline7d: [1, 2, 3],
      },
    ]);
  });

  it("honours COINGECKO_API_BASE and sends the key only when set", async () => {
    vi.stubEnv("COINGECKO_API_BASE", "http://127.0.0.1:9999/api");
    vi.stubEnv("COINGECKO_API_KEY", "k123");
    fetchMock.mockResolvedValue(json([]));
    await fetchTopMarkets();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9999\/api\/coins\/markets\?/);
    expect(init.headers["x-cg-demo-api-key"]).toBe("k123");
  });

  it("uses a 5000 ms timeout", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(json([]));
    await fetchTopMarkets();
    expect(spy).toHaveBeenCalledWith(5000);
    spy.mockRestore();
  });

  it("nulls non-finite numbers, defaults the sparkline and drops invalid rows", async () => {
    fetchMock.mockResolvedValue(
      json([
        { id: "x", symbol: "x", name: "X", current_price: null, market_cap: "12", total_volume: "NaN" },
        { id: "", name: "No id" },
        { id: "noname" },
        { id: "Bad/Id", name: "Bad" },
        null,
      ]),
    );
    const coins = await fetchTopMarkets();
    expect(coins).toHaveLength(1);
    expect(coins[0]).toMatchObject({
      id: "x",
      image: null,
      rank: null,
      priceUsd: null,
      change1h: null,
      change24h: null,
      change7d: null,
      marketCapUsd: null,
      volumeUsd: null,
      sparkline7d: [],
    });
  });

  it("keeps only https images on the CoinGecko hosts", async () => {
    const imgs = [
      "https://assets.coingecko.com/a.png",
      "https://coin-images.coingecko.com/a.png",
      "http://coin-images.coingecko.com/a.png",
      "https://evil.example.com/a.png",
      "https://coin-images.coingecko.com.evil.com/a.png",
      "javascript:alert(1)",
      "not a url",
    ];
    fetchMock.mockResolvedValue(json(imgs.map((image, i) => ({ id: `c${i}`, name: `C${i}`, symbol: "c", image }))));
    const coins = await fetchTopMarkets();
    expect(coins.map((c) => c.image)).toEqual([imgs[0], imgs[1], null, null, null, null, null]);
  });

  it("filters non-finite sparkline entries", async () => {
    fetchMock.mockResolvedValue(
      json([{ id: "x", name: "X", symbol: "x", sparkline_in_7d: { price: [1, null, "a", 2] } }]),
    );
    expect((await fetchTopMarkets())[0]!.sparkline7d).toEqual([1, 2]);
  });

  it.each([
    ["non-2xx", () => fetchMock.mockResolvedValue(json({ error: "rate" }, 429))],
    ["5xx", () => fetchMock.mockResolvedValue(json({}, 503))],
    ["network error", () => fetchMock.mockRejectedValue(new TypeError("fetch failed"))],
    ["timeout", () => fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"))],
    ["non-array body", () => fetchMock.mockResolvedValue(json({ status: "ok" }))],
    ["malformed JSON", () => fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }))],
  ])("throws MarketUnavailableError on %s", async (_n, setup) => {
    setup();
    await expect(fetchTopMarkets()).rejects.toBeInstanceOf(MarketUnavailableError);
  });
});

describe("fetchCoin", () => {
  const body = {
    id: "bitcoin",
    symbol: "btc",
    name: "Bitcoin",
    image: { large: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png" },
    market_cap_rank: 1,
    links: { homepage: ["https://bitcoin.org", ""] },
    market_data: {
      current_price: { usd: 65000 },
      price_change_percentage_24h: -1.5,
      market_cap: { usd: 1.2e12 },
      total_volume: { usd: 3e10 },
      circulating_supply: 19e6,
      max_supply: 21e6,
      ath: { usd: 73000 },
      ath_date: { usd: "2024-03-14T07:10:36.635Z" },
    },
  };

  it("calls the detail endpoint and maps the fields", async () => {
    fetchMock.mockResolvedValue(json(body));
    const c = await fetchCoin("bitcoin");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false",
    );
    expect(c).toEqual({
      id: "bitcoin",
      symbol: "btc",
      name: "Bitcoin",
      image: body.image.large,
      rank: 1,
      priceUsd: 65000,
      change24h: -1.5,
      marketCapUsd: 1.2e12,
      volumeUsd: 3e10,
      circulatingSupply: 19e6,
      maxSupply: 21e6,
      athUsd: 73000,
      athDate: "2024-03-14T07:10:36.635Z",
      homepage: "https://bitcoin.org",
    });
  });

  it("keeps the homepage only if https and nulls missing market data", async () => {
    fetchMock.mockResolvedValue(
      json({ id: "x", symbol: "x", name: "X", links: { homepage: ["http://x.example"] }, market_data: { max_supply: null } }),
    );
    const c = await fetchCoin("x");
    expect(c.homepage).toBeNull();
    expect(c.priceUsd).toBeNull();
    expect(c.maxSupply).toBeNull();
    expect(c.athDate).toBeNull();
    expect(c.image).toBeNull();
  });

  it("404 -> CoinNotFoundError", async () => {
    fetchMock.mockResolvedValue(json({ error: "coin not found" }, 404));
    await expect(fetchCoin("nope")).rejects.toBeInstanceOf(CoinNotFoundError);
  });

  it("other failures -> MarketUnavailableError", async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(fetchCoin("bitcoin")).rejects.toBeInstanceOf(MarketUnavailableError);
    fetchMock.mockResolvedValue(json("nope"));
    await expect(fetchCoin("bitcoin")).rejects.toBeInstanceOf(MarketUnavailableError);
  });

  it("invalid id -> CoinNotFoundError without fetching", async () => {
    await expect(fetchCoin("../x")).rejects.toBeInstanceOf(CoinNotFoundError);
    await expect(fetchCoin("Bitcoin")).rejects.toBeInstanceOf(CoinNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("fetchChart", () => {
  it("calls market_chart and filters to finite pairs", async () => {
    fetchMock.mockResolvedValue(json({ prices: [[1, 10], [2, null], ["a", 3], [3], [4, 12]] }));
    const pts = await fetchChart("bitcoin", "7");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7");
    expect(pts).toEqual([[1, 10], [4, 12]]);
  });

  it("404 -> CoinNotFoundError, bad body -> MarketUnavailableError", async () => {
    fetchMock.mockResolvedValue(json({}, 404));
    await expect(fetchChart("nope", "30")).rejects.toBeInstanceOf(CoinNotFoundError);
    fetchMock.mockResolvedValue(json({ nope: 1 }));
    await expect(fetchChart("bitcoin", "30")).rejects.toBeInstanceOf(MarketUnavailableError);
  });

  it("invalid id or range without fetching", async () => {
    await expect(fetchChart("a/b", "1")).rejects.toBeInstanceOf(CoinNotFoundError);
    await expect(fetchChart("bitcoin", "9" as never)).rejects.toBeInstanceOf(MarketUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
