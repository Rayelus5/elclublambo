import type { AdminReferralCode, AdminReferralOwner, AdminReferralRow, AdminReferralSummary, MyReferrals, ReferralOverride, ReferralState } from '@galaxy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// Referrals (plan «referidos», part R2): the admins' «Referidos» (under the panel's key, so every change from the
// panel reads them again) and the player's own codes.

const KEY = [...ADMIN_KEY, 'referrals'] as const;

/** The numbers of «Resumen»: codes, sign-ups, activation, held and rewarded. */
export function useReferralSummary() {
  return useQuery({ queryKey: [...KEY, 'summary'], queryFn: () => api<AdminReferralSummary>('/admin/referrals/summary') });
}

/** Every code (the newest first), or those whose code or owner contains `q`. */
export function useReferralCodes(q: string) {
  const path = q ? `/admin/referrals/codes?${new URLSearchParams({ q }).toString()}` : '/admin/referrals/codes';
  return useQuery({ queryKey: [...KEY, 'codes', q], queryFn: () => api<AdminReferralCode[]>(path), placeholderData: keepPreviousData });
}

export interface ReferralListQuery {
  state: ReferralState | null;
  flagged: boolean;
  q: string;
  page: number;
}

/** The query string of a page of newcomers, its filters always in the same order. */
export function referralListSearch(q: ReferralListQuery): string {
  const p = new URLSearchParams();
  if (q.state) p.set('state', q.state);
  if (q.flagged) p.set('flagged', '1');
  if (q.q) p.set('q', q.q);
  p.set('page', String(q.page));
  return p.toString();
}

/** A page of newcomers with its filters. */
export function useReferralList(q: ReferralListQuery) {
  const search = referralListSearch(q);
  return useQuery({
    queryKey: [...KEY, 'list', search],
    queryFn: () => api<{ rows: AdminReferralRow[]; total: number; page: number; pages: number }>(`/admin/referrals?${search}`),
    placeholderData: keepPreviousData,
  });
}

/** An owner's own rewards and the ones their codes follow; nothing asked until there is a name. */
export function useReferralOwner(username: string) {
  return useQuery({
    queryKey: [...KEY, 'owner', username],
    queryFn: () => api<AdminReferralOwner>(`/admin/referrals/owners/${encodeURIComponent(username)}`),
    enabled: username !== '',
    retry: false,
  });
}

/** Saves an owner's own rewards (all three fields; null is the global one), with a reason. */
export function useSaveReferralOwner(username: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReferralOverride & { reason: string }) => api<AdminReferralOwner>(`/admin/referrals/owners/${encodeURIComponent(username)}`, { method: 'PUT', body }),
    onSuccess: (data) => qc.setQueryData([...KEY, 'owner', username], data),
    onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
}

/** The player's own codes and how many came in with them (empty for almost everyone). */
export function useMyReferrals(enabled: boolean) {
  return useQuery({ queryKey: ['referrals', 'mine'], queryFn: () => api<MyReferrals>('/referrals/mine'), enabled, staleTime: 60_000, retry: false });
}
