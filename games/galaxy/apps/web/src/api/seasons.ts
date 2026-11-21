import type { AdminSeason, AdminSeasonList, SeasonIssue } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The panel's «Temporadas» (plan «temporadas como fichas», 2026-11-21): the list, the checks, and every change. Each
// change refreshes the list and what players read of the season (an admin is a player too).

export const ADMIN_SEASONS_KEY = ['admin', 'seasons'] as const;

export function useAdminSeasons() {
  return useQuery({ queryKey: ADMIN_SEASONS_KEY, queryFn: () => api<AdminSeasonList>('/admin/seasons'), staleTime: 10_000 });
}

function useSeasonMutation<V>(fn: (v: V) => Promise<AdminSeason | undefined>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ADMIN_SEASONS_KEY });
      void qc.invalidateQueries({ queryKey: ['season'] });
      void qc.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
}

export const useSaveSeason = () => useSeasonMutation((v: { record: unknown; reason: string }) => api<AdminSeason>('/admin/seasons', { method: 'POST', body: v }));
export const useScheduleSeason = () => useSeasonMutation((v: { id: string; reason: string; password: string }) => api<AdminSeason>(`/admin/seasons/${v.id}/schedule`, { method: 'POST', body: { reason: v.reason, password: v.password } }));
export const useUnscheduleSeason = () => useSeasonMutation((v: { id: string; reason: string; password: string }) => api<AdminSeason>(`/admin/seasons/${v.id}/unschedule`, { method: 'POST', body: { reason: v.reason, password: v.password } }));
export const useExtendSeason = () =>
  useSeasonMutation((v: { id: string; endsAt: string; moveNext: boolean; reason: string; password: string }) =>
    api<AdminSeason>(`/admin/seasons/${v.id}/extend`, { method: 'POST', body: { endsAt: v.endsAt, moveNext: v.moveNext, reason: v.reason, password: v.password } }),
  );
export const useDeleteSeason = () => useSeasonMutation(async (v: { id: string; reason: string }) => {
  await api<void>(`/admin/seasons/${v.id}/delete`, { method: 'POST', body: { reason: v.reason } });
  return undefined;
});

/** The server's checks of a record as the wizard has it (its own problems and overlaps with other seasons). */
export function useValidateSeason(record: unknown, enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'seasons', 'validate', JSON.stringify(record)],
    queryFn: () => api<{ ok: boolean; issues: SeasonIssue[] }>('/admin/seasons/validate', { method: 'POST', body: { record } }),
    enabled,
    staleTime: 30_000,
  });
}
