import type { CatalogSummary } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// The ECN Catalogue's light (polish): rewards reached and waiting, for the hub's Colección tile and the collection's
// Catálogo button. The album itself is fetched by its screen (collection/CatalogScreen.tsx).

export const CATALOG_KEY = ['catalog'] as const;
export const CATALOG_SUMMARY_KEY = ['catalog', 'summary'] as const;

export function useCatalogSummary() {
  return useQuery({ queryKey: CATALOG_SUMMARY_KEY, queryFn: () => api<CatalogSummary>('/catalog/summary'), staleTime: 60_000 });
}
