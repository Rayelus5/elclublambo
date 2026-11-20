import type { AdminPriceCheck, AdminShopAlert, AdminShopBlock, AdminShopPurchase, AdminShopSummary, ShopPurchaseStatus } from '@galaxy/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// The resource shop in the panel (shop and lab plan, F5b), admins only. Every key sits under the panel's, so a change
// made from the panel (reviewing, blocking, syncing) reads them again.

export type ShopPurchasesFilter = { status?: ShopPurchaseStatus; username?: string; page: number };

/** The filter as a query string, in a fixed order: status, username, page. */
export function shopPurchasesSearch(f: ShopPurchasesFilter): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.username) p.set('username', f.username);
  p.set('page', String(f.page));
  return p.toString();
}

export function useShopSummary() {
  return useQuery({ queryKey: [...ADMIN_KEY, 'shop', 'summary'], queryFn: () => api<AdminShopSummary>('/admin/shop/summary') });
}

export function useShopPurchases(f: ShopPurchasesFilter) {
  return useQuery({
    queryKey: [...ADMIN_KEY, 'shop', 'purchases', f],
    queryFn: () => api<{ rows: AdminShopPurchase[]; page: number; pages: number }>(`/admin/shop/purchases?${shopPurchasesSearch(f)}`),
    placeholderData: keepPreviousData,
  });
}

export function useShopAlerts(open: boolean) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'shop', 'alerts', open], queryFn: () => api<AdminShopAlert[]>(`/admin/shop/alerts?open=${open}`) });
}

export function useShopBlocks() {
  return useQuery({ queryKey: [...ADMIN_KEY, 'shop', 'blocks'], queryFn: () => api<AdminShopBlock[]>('/admin/shop/blocks') });
}

/** Every Stripe price of the catalogue against the shop's (read on demand: it calls Stripe). */
export function useVerifyPrices() {
  return useMutation({ mutationFn: () => api<AdminPriceCheck[]>('/admin/shop/prices/verify', { method: 'POST', body: {} }) });
}
