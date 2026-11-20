import type { AdminPlayer, AdminPlayerList, AdminPlayerQuery, AdminProgress, AdminSection, AdminSectionName, AuditPage, AuditQuery } from '@galaxy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The admin panel (GDD §16; M6a): finding players, a player's page and histories, the changes, and the audit log.
// After any change the player's page and the audit are read again.

export const ADMIN_KEY = ['admin'] as const;

/** The players list (plan «escáner pro», part F): every filter is always sent, in a fixed order. */
export function usePlayerList(q: AdminPlayerQuery) {
  const search = new URLSearchParams({ q: q.q, state: q.state, sort: q.sort, dir: q.dir, page: String(q.page) }).toString();
  return useQuery({
    queryKey: [...ADMIN_KEY, 'list', search],
    queryFn: () => api<AdminPlayerList>(`/admin/players?${search}`),
    placeholderData: keepPreviousData,
  });
}

/** The «Progreso» tab (M6d-4): luck, probes, machines, Laboratorio and season. */
export function useAdminProgress(username: string) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'progress', username], queryFn: () => api<AdminProgress>(`/admin/players/${encodeURIComponent(username)}/progress`), retry: false });
}

export function useAdminPlayer(username: string) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'player', username], queryFn: () => api<AdminPlayer>(`/admin/players/${encodeURIComponent(username)}`), retry: false });
}

export function usePlayerSection(username: string, section: AdminSectionName | null, page: number) {
  return useQuery({
    queryKey: [...ADMIN_KEY, 'player', username, section, page],
    queryFn: () => api<AdminSection>(`/admin/players/${encodeURIComponent(username)}/${section}?page=${page}`),
    enabled: section !== null,
    placeholderData: keepPreviousData,
  });
}

/**
 * A change from the panel (to a player, a message, a mute, a clan or a referral code): `url` follows `/galaxy/api`. A
 * POST unless it says PUT (a code's limits, an owner's rewards).
 */
export function useAdminPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { url: string; body: unknown; method?: 'POST' | 'PUT' }) => api<Record<string, unknown>>(v.url, { method: v.method ?? 'POST', body: v.body }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ADMIN_KEY }),
  });
}

/** The audit filters as a query string, in a fixed order (the CSV export uses the same ones). */
export function auditSearch(q: Partial<AuditQuery>, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const k of ['actor', 'action', 'target', 'from', 'to'] as const) if (q[k]) params.set(k, q[k]!);
  if (q.page) params.set('page', String(q.page));
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params.toString();
}

export function useAudit(q: Partial<AuditQuery>) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'audit', q], queryFn: () => api<AuditPage>(`/admin/audit?${auditSearch(q)}`), placeholderData: keepPreviousData });
}
