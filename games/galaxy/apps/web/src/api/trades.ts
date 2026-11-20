import type { MyTradePosts, MyTrades, Tier, TradeBoardPage, TradeOffer, TradePostInput, TradePostView, TradePropose, TradeView } from '@galaxy/shared';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { COLLECTION_KEY, endIntent, keyFor } from './economy';

// The swaps (GDD §14.5; M5c-2): one's trades and the four changes. Proposing is idempotent; changing and confirming
// name the version seen. After any of them the trades and the collection are read again (a swap moves galaxies).

export const TRADES_KEY = ['trades'] as const;

export function useTrades() {
  return useQuery({ queryKey: TRADES_KEY, queryFn: () => api<MyTrades>('/trades') });
}

function useAfter() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: TRADES_KEY });
    void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
  };
}

export function useProposeTrade() {
  const after = useAfter();
  const intent = (v: TradePropose) => `trade:propose:${JSON.stringify(v)}`;
  return useMutation({
    mutationFn: (v: TradePropose) => api<TradeView>('/trades', { method: 'POST', body: v, headers: keyFor(intent(v)) }),
    onSettled: (_r, error, v) => {
      after();
      endIntent(intent(v), error);
    },
  });
}

export function useChangeTrade() {
  const after = useAfter();
  return useMutation({
    mutationFn: (v: TradeOffer & { id: string }) => api<TradeView>(`/trades/${v.id}/offer`, { method: 'POST', body: { give: v.give, want: v.want, version: v.version } }),
    onSettled: () => after(),
  });
}

export function useConfirmTrade() {
  const after = useAfter();
  return useMutation({
    mutationFn: (v: { id: string; version: number }) => api<TradeView>(`/trades/${v.id}/confirm`, { method: 'POST', body: { version: v.version } }),
    onSettled: () => after(),
  });
}

export function useCancelTrade() {
  const after = useAfter();
  return useMutation({
    mutationFn: (id: string) => api<TradeView>(`/trades/${id}/cancel`, { method: 'POST' }),
    onSettled: () => after(),
  });
}

// The public trade board (2026-11-14): a page of posts at a time (optionally only those giving a rarity), my posts,
// posting one (idempotent) and withdrawing it. Answering one is proposing a trade with `post`.
export const BOARD_KEY = [...TRADES_KEY, 'board'] as const;

export function useTradeBoard(tier: Tier | undefined) {
  return useInfiniteQuery({
    queryKey: [...BOARD_KEY, 'list', tier ?? 'all'],
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams();
      if (tier) q.set('tier', tier);
      if (pageParam) q.set('cursor', pageParam);
      const qs = q.toString();
      return api<TradeBoardPage>(`/trades/board${qs ? `?${qs}` : ''}`);
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useMyPosts() {
  return useQuery({ queryKey: [...BOARD_KEY, 'mine'], queryFn: () => api<MyTradePosts>('/trades/posts/mine') });
}

export function useCreatePost() {
  const qc = useQueryClient();
  const intent = (v: TradePostInput) => `trade:post:${JSON.stringify(v)}`;
  return useMutation({
    mutationFn: (v: TradePostInput) => api<TradePostView>('/trades/posts', { method: 'POST', body: v, headers: keyFor(intent(v)) }),
    onSettled: (_r, error, v) => {
      void qc.invalidateQueries({ queryKey: BOARD_KEY });
      endIntent(intent(v), error);
    },
  });
}

export function useCancelPost() {
  const after = useAfter();
  return useMutation({
    mutationFn: (id: string) => api<{ cancelled: true }>(`/trades/posts/${id}/cancel`, { method: 'POST' }),
    onSettled: () => after(),
  });
}
