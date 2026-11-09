import type { AdminRunList, AdminRunReplay } from '@galaxy/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// The panel's runs (GDD §16.2, §16.6; M6d-3), admins only. Every key sits under the panel's, so a mark reads them again.

export type RunsFilter = { player?: string; suspicious?: boolean; group?: boolean; page: number };

/** The filter as a query string, always in the same order: player, suspicious, group, page. */
export function runsSearch(f: RunsFilter): string {
  const p = new URLSearchParams();
  if (f.player) p.set('player', f.player);
  if (f.suspicious) p.set('suspicious', 'true');
  if (f.group) p.set('group', 'true');
  p.set('page', String(f.page));
  return p.toString();
}

export function useAdminRuns(f: RunsFilter) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'runs', f], queryFn: () => api<AdminRunList>(`/admin/runs?${runsSearch(f)}`), placeholderData: keepPreviousData });
}

/** A run with what replays it; read once (the inputs and the content never change), again only after a mark. */
export function useAdminRun(id: string) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'run', id], queryFn: () => api<AdminRunReplay>(`/admin/runs/${id}`), staleTime: Infinity, refetchOnWindowFocus: false });
}
