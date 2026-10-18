import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchChart, fetchCoin, fetchTopMarkets, isCoinId } from "@/lib/market/coingecko";
import {
  CHART_RANGES,
  CoinNotFoundError,
  MarketUnavailableError,
  type Cached,
  type ChartPoint,
  type ChartRange,
  type CoinDetail,
  type MarketCoin,
} from "@/lib/market/types";

const TTL_MARKETS_MS = 60_000;
const TTL_DETAIL_MS = 300_000;

export type MarketStore = {
  read(key: string): Promise<{ payload: unknown; fetchedAt: string } | null>;
  write(key: string, payload: unknown, fetchedAt: string): Promise<void>;
};

export type MarketDeps = {
  store: MarketStore;
  fetchers: {
    fetchTopMarkets: typeof fetchTopMarkets;
    fetchCoin: typeof fetchCoin;
    fetchChart: typeof fetchChart;
  };
  now: () => number;
};

/** Service-role table `market_cache` (RLS on, no policies, no grants for members). */
export function createSupabaseStore(): MarketStore {
  return {
    async read(key) {
      const { data, error } = await createAdminClient()
        .from("market_cache")
        .select("payload, fetched_at")
        .eq("key", key)
        .maybeSingle();
      if (error) throw error;
      return data ? { payload: data.payload, fetchedAt: new Date(data.fetched_at).toISOString() } : null;
    },
    async write(key, payload, fetchedAt) {
      const { error } = await createAdminClient()
        .from("market_cache")
        .upsert({ key, payload: payload as never, fetched_at: fetchedAt }, { onConflict: "key" });
      if (error) throw error;
    },
  };
}

function defaultDeps(): MarketDeps {
  return { store: createSupabaseStore(), fetchers: { fetchTopMarkets, fetchCoin, fetchChart }, now: Date.now };
}

async function cached<T>(
  key: string,
  ttlMs: number,
  valid: (p: unknown) => boolean,
  fetcher: () => Promise<T>,
  deps: MarketDeps,
): Promise<Cached<T>> {
  let copy: { data: T; fetchedAt: string } | null = null;
  try {
    const row = await deps.store.read(key);
    const at = row ? Date.parse(row.fetchedAt) : NaN;
    if (row && Number.isFinite(at) && valid(row.payload)) copy = { data: row.payload as T, fetchedAt: row.fetchedAt };
  } catch {
    copy = null; // store trouble never blocks the page
  }
  const now = deps.now();
  if (copy && now - Date.parse(copy.fetchedAt) <= ttlMs && now >= Date.parse(copy.fetchedAt)) {
    return { ...copy, stale: false };
  }
  try {
    const data = await fetcher();
    const fetchedAt = new Date(now).toISOString();
    try {
      await deps.store.write(key, data, fetchedAt);
    } catch {
      // ignore: the fresh data is still good
    }
    return { data, fetchedAt, stale: false };
  } catch (e) {
    if (e instanceof CoinNotFoundError) throw e;
    if (copy) return { ...copy, stale: true };
    if (e instanceof MarketUnavailableError) throw e;
    throw new MarketUnavailableError("unexpected");
  }
}

const isArray = (p: unknown) => Array.isArray(p);
const isObject = (p: unknown) => typeof p === "object" && p !== null && !Array.isArray(p);

export function getTopMarkets(deps: MarketDeps = defaultDeps()): Promise<Cached<MarketCoin[]>> {
  return cached("markets:top100", TTL_MARKETS_MS, isArray, () => deps.fetchers.fetchTopMarkets(), deps);
}

export function getCoin(id: string, deps: MarketDeps = defaultDeps()): Promise<Cached<CoinDetail>> {
  if (!isCoinId(id)) return Promise.reject(new CoinNotFoundError());
  return cached(`coin:${id}`, TTL_DETAIL_MS, isObject, () => deps.fetchers.fetchCoin(id), deps);
}

export function getChart(
  id: string,
  range: ChartRange,
  deps: MarketDeps = defaultDeps(),
): Promise<Cached<ChartPoint[]>> {
  if (!isCoinId(id)) return Promise.reject(new CoinNotFoundError());
  if (!CHART_RANGES.includes(range)) return Promise.reject(new CoinNotFoundError());
  return cached(`chart:${id}:${range}`, TTL_DETAIL_MS, isArray, () => deps.fetchers.fetchChart(id, range), deps);
}
