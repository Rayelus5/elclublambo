import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getChart, getCoin, getTopMarkets, type MarketStore } from "@/lib/market/cache";
import { CoinNotFoundError, MarketUnavailableError, type MarketCoin } from "@/lib/market/types";

function fakeStore(initial: Record<string, { payload: unknown; fetchedAt: string }> = {}) {
  const rows = new Map(Object.entries(initial));
  const store: MarketStore & { rows: typeof rows } = {
    rows,
    read: vi.fn(async (key: string) => rows.get(key) ?? null),
    write: vi.fn(async (key: string, payload: unknown, fetchedAt: string) => {
      rows.set(key, { payload, fetchedAt });
    }),
  };
  return store;
}

const T0 = Date.parse("2026-10-18T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const coin = { id: "bitcoin" } as MarketCoin;

function deps(store: MarketStore, fetchers: Record<string, unknown>, now = T0) {
  return { store, fetchers: fetchers as never, now: () => now };
}

describe("getTopMarkets", () => {
  it("fresh copy within 60 s: no fetch, not stale", async () => {
    const store = fakeStore({ "markets:top100": { payload: [coin], fetchedAt: iso(T0 - 59_000) } });
    const fetchTopMarkets = vi.fn();
    const r = await getTopMarkets(deps(store, { fetchTopMarkets }));
    expect(fetchTopMarkets).not.toHaveBeenCalled();
    expect(r).toEqual({ data: [coin], fetchedAt: iso(T0 - 59_000), stale: false });
  });

  it("older than 60 s: fetches, stores and returns the new copy", async () => {
    const store = fakeStore({ "markets:top100": { payload: [], fetchedAt: iso(T0 - 61_000) } });
    const fetchTopMarkets = vi.fn().mockResolvedValue([coin]);
    const r = await getTopMarkets(deps(store, { fetchTopMarkets }));
    expect(r).toEqual({ data: [coin], fetchedAt: iso(T0), stale: false });
    expect(store.write).toHaveBeenCalledWith("markets:top100", [coin], iso(T0));
  });

  it("older copy + MarketUnavailableError: returns the old copy as stale", async () => {
    const store = fakeStore({ "markets:top100": { payload: [coin], fetchedAt: iso(T0 - 600_000) } });
    const fetchTopMarkets = vi.fn().mockRejectedValue(new MarketUnavailableError("down"));
    const r = await getTopMarkets(deps(store, { fetchTopMarkets }));
    expect(r).toEqual({ data: [coin], fetchedAt: iso(T0 - 600_000), stale: true });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("no copy + failure: rethrows MarketUnavailableError", async () => {
    const store = fakeStore();
    const fetchTopMarkets = vi.fn().mockRejectedValue(new MarketUnavailableError("down"));
    await expect(getTopMarkets(deps(store, { fetchTopMarkets }))).rejects.toBeInstanceOf(MarketUnavailableError);
  });

  it("any unexpected fetcher error is surfaced as MarketUnavailableError", async () => {
    const fetchTopMarkets = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(getTopMarkets(deps(fakeStore(), { fetchTopMarkets }))).rejects.toBeInstanceOf(MarketUnavailableError);
  });

  it("store read/write failures never break a successful fetch", async () => {
    const store: MarketStore = {
      read: vi.fn().mockRejectedValue(new Error("db down")),
      write: vi.fn().mockRejectedValue(new Error("db down")),
    };
    const fetchTopMarkets = vi.fn().mockResolvedValue([coin]);
    const r = await getTopMarkets(deps(store, { fetchTopMarkets }));
    expect(r).toEqual({ data: [coin], fetchedAt: iso(T0), stale: false });
  });

  it("a garbage stored payload is ignored", async () => {
    const store = fakeStore({ "markets:top100": { payload: { nope: 1 }, fetchedAt: iso(T0 - 1000) } });
    const fetchTopMarkets = vi.fn().mockResolvedValue([coin]);
    const r = await getTopMarkets(deps(store, { fetchTopMarkets }));
    expect(fetchTopMarkets).toHaveBeenCalled();
    expect(r.stale).toBe(false);
  });
});

describe("getCoin / getChart", () => {
  it("coin: key coin:{id}, TTL 300 s", async () => {
    const detail = { id: "bitcoin" };
    const store = fakeStore({ "coin:bitcoin": { payload: detail, fetchedAt: iso(T0 - 299_000) } });
    const fetchCoin = vi.fn();
    expect((await getCoin("bitcoin", deps(store, { fetchCoin }))).stale).toBe(false);
    expect(fetchCoin).not.toHaveBeenCalled();

    const store2 = fakeStore({ "coin:bitcoin": { payload: detail, fetchedAt: iso(T0 - 301_000) } });
    const fetchCoin2 = vi.fn().mockResolvedValue({ id: "bitcoin", name: "new" });
    await getCoin("bitcoin", deps(store2, { fetchCoin: fetchCoin2 }));
    expect(fetchCoin2).toHaveBeenCalledWith("bitcoin");
    expect(store2.write).toHaveBeenCalledWith("coin:bitcoin", { id: "bitcoin", name: "new" }, iso(T0));
  });

  it("chart: key chart:{id}:{range}, TTL 300 s", async () => {
    const pts = [[1, 2]];
    const store = fakeStore({ "chart:bitcoin:7": { payload: pts, fetchedAt: iso(T0 - 299_000) } });
    const fetchChart = vi.fn();
    const r = await getChart("bitcoin", "7", deps(store, { fetchChart }));
    expect(r).toEqual({ data: pts, fetchedAt: iso(T0 - 299_000), stale: false });

    const store2 = fakeStore();
    const fetchChart2 = vi.fn().mockResolvedValue(pts);
    await getChart("bitcoin", "365", deps(store2, { fetchChart: fetchChart2 }));
    expect(fetchChart2).toHaveBeenCalledWith("bitcoin", "365");
    expect(store2.write).toHaveBeenCalledWith("chart:bitcoin:365", pts, iso(T0));
  });

  it("CoinNotFoundError is rethrown and nothing is stored", async () => {
    const store = fakeStore();
    const fetchCoin = vi.fn().mockRejectedValue(new CoinNotFoundError("nope"));
    await expect(getCoin("nope", deps(store, { fetchCoin }))).rejects.toBeInstanceOf(CoinNotFoundError);
    expect(store.write).not.toHaveBeenCalled();
    const fetchChart = vi.fn().mockRejectedValue(new CoinNotFoundError("nope"));
    await expect(getChart("nope", "1", deps(store, { fetchChart }))).rejects.toBeInstanceOf(CoinNotFoundError);
    expect(store.write).not.toHaveBeenCalled();
  });

  it("invalid id never touches the store or the network", async () => {
    const store = fakeStore();
    const fetchCoin = vi.fn();
    await expect(getCoin("../x", deps(store, { fetchCoin }))).rejects.toBeInstanceOf(CoinNotFoundError);
    await expect(getChart("A", "7", deps(store, { fetchChart: vi.fn() }))).rejects.toBeInstanceOf(CoinNotFoundError);
    expect(store.read).not.toHaveBeenCalled();
    expect(fetchCoin).not.toHaveBeenCalled();
  });
});
