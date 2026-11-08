import type { AdminAlertsPage, AdminDealsPage, DealLineage } from '@galaxy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// Trade moderation (GDD §16.4; M6c-2), admins only: the history of listings and trades, a deal's lineage before
// reverting it, and the alerts. Every key sits under the panel's, so any change from the panel reads them again.

export type DealsFilter = { kind: 'listings' | 'trades'; user?: string; status?: string; page: number };

/** The filter as a query string, always in the same order: kind, user, status, page. */
export function dealsSearch(f: DealsFilter): string {
  const p = new URLSearchParams({ kind: f.kind });
  if (f.user) p.set('user', f.user);
  if (f.status) p.set('status', f.status);
  p.set('page', String(f.page));
  return p.toString();
}

export function useAdminDeals(f: DealsFilter) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'deals', f], queryFn: () => api<AdminDealsPage>(`/admin/market/deals?${dealsSearch(f)}`), placeholderData: keepPreviousData });
}

/** Where each galaxy of a sale or a trade is now (read when the revert dialog opens). */
export function useDealLineage(kind: 'listing' | 'trade', id: string) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'lineage', kind, id], queryFn: () => api<DealLineage>(`/admin/market/lineage?kind=${kind}&id=${id}`), retry: false });
}

export function useAdminAlerts(reviewed: boolean, page: number) {
  return useQuery({
    queryKey: [...ADMIN_KEY, 'alerts', reviewed, page],
    queryFn: () => api<AdminAlertsPage>(`/admin/market/alerts?reviewed=${reviewed}&page=${page}`),
    placeholderData: keepPreviousData,
  });
}
