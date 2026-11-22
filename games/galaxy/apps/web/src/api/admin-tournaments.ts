import type { AdminTournament, AdminTournamentCash, AdminTournamentList, AdminTournamentReview, TournamentDecideManyResult, TournamentValidation, UnverifiableReason } from '@galaxy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The panel's «Torneos» (plan «temporadas como fichas», part 5; GDD §13.3): the list, one tournament, its review, the
// money still to pay, the server's checks of a record as the wizard has it, and every change. Each change reads the
// panel's tournaments again and what players read of them (an admin is a player too). Types: packages/shared/src/api/
// tournaments.ts.

export const ADMIN_TOURNAMENTS_KEY = ['admin', 'tournaments'] as const;

export function useAdminTournaments() {
  return useQuery({ queryKey: ADMIN_TOURNAMENTS_KEY, queryFn: () => api<AdminTournamentList>('/admin/tournaments'), staleTime: 10_000 });
}

/** One tournament (a draft the wizard edits, or the one a copy starts from). */
export function useAdminTournament(id: string | null) {
  return useQuery({ queryKey: [...ADMIN_TOURNAMENTS_KEY, 'one', id], queryFn: () => api<AdminTournament>(`/admin/tournaments/${id}`), enabled: !!id });
}

/** Everything the review panel shows; read again every 15 s while the server is still checking runs. */
export function useTournamentReview(id: string) {
  return useQuery({
    queryKey: [...ADMIN_TOURNAMENTS_KEY, 'review', id],
    queryFn: () => api<AdminTournamentReview>(`/admin/tournaments/${id}/review`),
    refetchInterval: (q) => (q.state.data && (q.state.data.tournament.state === 'review' || q.state.data.tournament.state === 'running') ? 15_000 : false),
  });
}

/** The money prizes of every tournament, the unpaid first. */
export function useTournamentCash() {
  return useQuery({ queryKey: [...ADMIN_TOURNAMENTS_KEY, 'cash'], queryFn: () => api<{ cash: AdminTournamentCash[] }>('/admin/tournaments/cash') });
}

/** The server's checks of a record as the wizard has it (`id`: the draft being edited, whose own slug is not taken). */
export function useValidateTournament(record: unknown, id: string | null, enabled: boolean) {
  const body = id ? { record, id } : { record };
  return useQuery({
    queryKey: [...ADMIN_TOURNAMENTS_KEY, 'validate', JSON.stringify(body)],
    queryFn: () => api<TournamentValidation>('/admin/tournaments/validate', { method: 'POST', body }),
    enabled,
    staleTime: 30_000,
    // The last answer stays while the next is asked (its reasons for a superadmin do not flicker as the admin types).
    placeholderData: keepPreviousData,
  });
}

function useTournamentMutation<V, R>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ADMIN_TOURNAMENTS_KEY });
      void qc.invalidateQueries({ queryKey: ['tournaments'] });
    },
  });
}

const post = <R>(path: string, body: unknown) => api<R>(`/admin/tournaments${path}`, { method: 'POST', body });

/** A draft saved: a new one, or the one being edited replaced whole at the version the admin read. */
export const useSaveTournament = () =>
  useTournamentMutation((v: { id: string | null; version: number | null; record: unknown; reason: string }) =>
    v.id ? post<AdminTournament>(`/${v.id}`, { record: v.record, version: v.version, reason: v.reason }) : post<AdminTournament>('', { record: v.record, reason: v.reason }),
  );
export const useDeleteTournament = () => useTournamentMutation((v: { id: string; reason: string }) => post<void>(`/${v.id}/delete`, { reason: v.reason }));
export const useScheduleTournament = () => useTournamentMutation((v: { id: string; version: number; reason: string; password: string }) => post<AdminTournament>(`/${v.id}/schedule`, { version: v.version, reason: v.reason, password: v.password }));
export const useUnscheduleTournament = () => useTournamentMutation((v: { id: string; reason: string; password: string }) => post<AdminTournament>(`/${v.id}/unschedule`, { reason: v.reason, password: v.password }));
export const useCancelTournament = () => useTournamentMutation((v: { id: string; reason: string; password: string }) => post<AdminTournament & { refunded: number }>(`/${v.id}/cancel`, { reason: v.reason, password: v.password }));
export const usePublishTournament = () => useTournamentMutation((v: { id: string; reason: string; password: string }) => post<AdminTournamentReview>(`/${v.id}/publish`, { reason: v.reason, password: v.password }));
export const useDecideCheck = () =>
  useTournamentMutation((v: { id: string; run: string; decision: 'accept' | 'discard'; reason: string; password: string }) => post<AdminTournamentReview>(`/${v.id}/checks/${v.run}/decide`, { decision: v.decision, reason: v.reason, password: v.password }));
export const useDisqualify = () =>
  useTournamentMutation((v: { id: string; username: string; disqualified: boolean; reason: string; password: string }) =>
    post<AdminTournamentReview>(`/${v.id}/entries/${encodeURIComponent(v.username)}/disqualify`, { disqualified: v.disqualified, reason: v.reason, password: v.password }),
  );
export const useMarkCashPaid = () =>
  useTournamentMutation((v: { id: string; username: string; reason: string; password: string }) => post<AdminTournamentCash>(`/${v.id}/cash/${encodeURIComponent(v.username)}/paid`, { reason: v.reason, password: v.password }));

/** Every undecided run that could not be checked, of one reason or one player, decided at once. */
export const useDecideMany = () =>
  useTournamentMutation((v: { id: string; decision: 'accept' | 'discard'; filter: { reason?: UnverifiableReason; username?: string }; reason: string; password: string }) =>
    post<TournamentDecideManyResult>(`/${v.id}/checks/decide-many`, { decision: v.decision, filter: v.filter, reason: v.reason, password: v.password }),
  );
