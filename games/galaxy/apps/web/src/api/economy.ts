import type { CollectionPage, Finish, GachaView, Tier } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// Reads of the economy (GDD §9, §8.5). The server decides everything; the client only shows what it answers.
export const GACHA_KEY = ['gacha'] as const;
export const COLLECTION_KEY = ['galaxies'] as const;

/** Banners, costs, the daily free pull and the wallet. The first read of a new account also gives the welcome. */
export function useGacha() {
  return useQuery({ queryKey: GACHA_KEY, queryFn: () => api<GachaView>('/gacha'), staleTime: 30_000 });
}

export interface CollectionQuery {
  tier?: Tier;
  type?: string;
  palette?: string;
  finish?: Finish;
  sort?: 'new' | 'rarity';
  cursor?: string;
  limit?: number;
}

/** `/galaxies?…` with the parameters in a fixed order, so equal queries are equal URLs. */
export function collectionPath(q: CollectionQuery): string {
  const params = new URLSearchParams();
  for (const key of ['tier', 'type', 'palette', 'finish', 'sort', 'limit', 'cursor'] as const) {
    const value = q[key];
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `/galaxies?${search}` : '/galaxies';
}

export function useCollection(q: CollectionQuery) {
  return useQuery({ queryKey: [...COLLECTION_KEY, q], queryFn: () => api<CollectionPage>(collectionPath(q)), staleTime: 30_000 });
}
