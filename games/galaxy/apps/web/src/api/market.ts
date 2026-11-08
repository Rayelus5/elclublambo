import type { GachaView, GalaxySummary, MarketListing, MarketPage, MarketQuery, MyMarket, Wallet } from '@galaxy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { COLLECTION_KEY, endIntent, GACHA_KEY, keyFor } from './economy';

// The market (GDD §14.6; M5c-1): the listings, one's own listings and sales, and the three changes. Listing and buying
// are idempotent (a retry after a lost answer reuses the key); after any change the market, the balance and the
// collection are read again.

export const MARKET_KEY = ['market'] as const;

/** `/market?…` with its parameters in a fixed order, so equal searches are equal URLs. */
export function marketPath(q: Partial<MarketQuery>): string {
  const params = new URLSearchParams();
  if (q.tier) params.set('tier', q.tier);
  params.set('sort', q.sort ?? 'new');
  if (q.q) params.set('q', q.q);
  params.set('page', String(q.page ?? 1));
  return `/market?${params.toString()}`;
}

export function useMarket(q: Partial<MarketQuery>) {
  return useQuery({ queryKey: [...MARKET_KEY, 'list', q], queryFn: () => api<MarketPage>(marketPath(q)), placeholderData: keepPreviousData });
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
