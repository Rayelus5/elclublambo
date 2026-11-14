import type { GachaView, GalaxySummary, MarketListing, MarketPage, MarketQuery, MarketStats, MyMarket, Wallet } from '@galaxy/shared';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { COLLECTION_KEY, endIntent, GACHA_KEY, keyFor } from './economy';

// The market (GDD §14.6; M5c-1): the listings, one's own listings and sales, and the three changes. Listing and buying
// are idempotent (a retry after a lost answer reuses the key); after any change the market, the balance and the
// collection are read again.

export const MARKET_KEY = ['market'] as const;

/** What the market is searched by (all but the cursor). */
export type MarketSearch = Omit<Partial<MarketQuery>, 'cursor'>;
const ORDER = ['tier', 'finish', 'type', 'palette', 'phenomenon', 'minLevel', 'maxLevel', 'minPrice', 'maxPrice', 'q'] as const;

/** `/market?…` with its parameters in a fixed order, so equal searches are equal URLs. */
export function marketPath(q: Partial<MarketQuery>): string {
  const params = new URLSearchParams();
  for (const k of ORDER) {
    const v = q[k];
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  params.set('sort', q.sort ?? 'new');
  if (q.cursor) params.set('cursor', q.cursor);
  return `/market?${params.toString()}`;
}

/**
 * The listings that match, a page at a time (the owner, 2026-11-14: «profesional para 100.000 anuncios»): «Cargar
 * más» goes on from the last page's cursor; what was shown never moves.
 */
export function useMarket(q: MarketSearch) {
  return useInfiniteQuery({
    queryKey: [...MARKET_KEY, 'list', q],
    queryFn: ({ pageParam }) => api<MarketPage>(marketPath({ ...q, ...(pageParam ? { cursor: pageParam } : {}) })),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The market's public numbers (counted every few minutes by the server). */
export function useMarketStats(enabled = true) {
  return useQuery({ queryKey: [...MARKET_KEY, 'stats'], queryFn: () => api<MarketStats>('/market/stats'), enabled, staleTime: 60_000 });
}

export function useMyMarket() {
  return useQuery({ queryKey: [...MARKET_KEY, 'mine'], queryFn: () => api<MyMarket>('/market/mine') });
}

function useAfterTrade() {
  const qc = useQueryClient();
  return (wallet?: Wallet) => {
    if (wallet) qc.setQueryData<GachaView>(GACHA_KEY, (old) => (old ? { ...old, wallet } : old));
    else void qc.invalidateQueries({ queryKey: GACHA_KEY });
    void qc.invalidateQueries({ queryKey: MARKET_KEY });
    void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
  };
}

export function useListGalaxy() {
  const after = useAfterTrade();
  const intent = (v: { galaxyId: string; price: number }) => `market:list:${v.galaxyId}:${v.price}`;
  return useMutation({
    mutationFn: (v: { galaxyId: string; price: number }) => api<MarketListing>('/market/listings', { method: 'POST', body: v, headers: keyFor(intent(v)) }),
    onSettled: (_r, error, v) => {
      after();
      endIntent(intent(v), error);
    },
  });
}

export function useBuyListing() {
  const after = useAfterTrade();
  const intent = (id: string) => `market:buy:${id}`;
  return useMutation({
    mutationFn: (id: string) => api<{ galaxy: GalaxySummary; wallet: Wallet }>(`/market/listings/${id}/buy`, { method: 'POST', headers: keyFor(intent(id)) }),
    onSuccess: (r) => after(r.wallet),
    onError: () => after(),
    onSettled: (_r, error, id) => endIntent(intent(id), error),
  });
}

export function useCancelListing() {
  const after = useAfterTrade();
  return useMutation({
    mutationFn: (id: string) => api<{ cancelled: true }>(`/market/listings/${id}/cancel`, { method: 'POST' }),
    onSettled: () => after(),
  });
}
