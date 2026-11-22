import type { TournamentCard, TournamentClaimResult, TournamentDetail, TournamentEntryResult, TournamentList } from '@galaxy/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ME_KEY } from '../auth/useMe';
import { api } from './client';
import { refreshPieces } from './cosmetics';
import { COLLECTION_KEY, endIntent, GACHA_KEY, keyFor } from './economy';
import { syncWallet } from './wallet';

// The tournaments as players read them (plan «temporadas como fichas», part 5; GDD §13.3): the list of the three tabs,
// a tournament's page, signing up, leaving and collecting. Every query lives under TOURNAMENTS_KEY, so a live notice
// (live/notices.ts) or an action reads them all again. Each write carries its intent's idempotency key until it is
// answered: a lost answer resent is the same request, and never a second fee.

/** The prefix of every tournament query (the list and each page). */
export const TOURNAMENTS_KEY = ['tournaments'] as const;
export const TOURNAMENT_LIST_KEY = [...TOURNAMENTS_KEY, 'list'] as const;
export const tournamentKey = (slug: string) => [...TOURNAMENTS_KEY, 'page', slug] as const;

export const fetchTournaments = () => api<TournamentList>('/tournaments');

/**
 * The list. It is kept for hours once read (the lobby reads it before every run): the results of a run compare it with
 * the list read after, to say what the run added (RunLine).
 */
export function useTournaments() {
  return useQuery({ queryKey: TOURNAMENT_LIST_KEY, queryFn: fetchTournaments, staleTime: 30_000, gcTime: 3 * 3_600_000 });
}

export function useTournament(slug: string) {
  return useQuery({ queryKey: tournamentKey(slug), queryFn: () => api<TournamentDetail>(`/tournaments/${encodeURIComponent(slug)}`), staleTime: 15_000 });
}

/** A list read whole (an old or odd answer counts as none: the entry points stay quiet). */
export function listOf(data: TournamentList | undefined): TournamentCard[] {
  if (!data || !Array.isArray(data.running) || !Array.isArray(data.upcoming)) return [];
  return [...data.running, ...data.upcoming, ...(Array.isArray(data.finished) ? data.finished : [])];
}

/** Whether sign-up is open in some tournament (the menu's and the lobby's dot). */
export function signUpOpen(data: TournamentList | undefined): boolean {
  return listOf(data).some((c) => (c.state === 'running' || c.state === 'scheduled') && c.join.open);
}

function settle(qc: QueryClient, wallet: TournamentEntryResult['wallet']): void {
  syncWallet(qc, wallet);
  void qc.invalidateQueries({ queryKey: TOURNAMENTS_KEY });
}

/** Signs up for a tournament or leaves it: the new wallet everywhere, and every tournament read again. */
export function useTournamentEntry() {
  const qc = useQueryClient();
  const intent = (v: { id: string; action: 'join' | 'leave' }) => `tournament:${v.action}:${v.id}`;
  return useMutation({
    mutationFn: (v: { id: string; action: 'join' | 'leave' }) => api<TournamentEntryResult>(`/tournaments/${v.id}/${v.action}`, { method: 'POST', headers: keyFor(intent(v)) }),
    onSuccess: (r) => settle(qc, r.wallet),
    // A refusal (full, closed, already in) brings the real state, so the card says why.
    onError: () => {
      void qc.invalidateQueries({ queryKey: TOURNAMENTS_KEY });
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
    },
    onSettled: (_r, error, v) => endIntent(intent(v), error),
  });
}

/** Collects a finished tournament's prizes: the wallet, the pieces, the galaxies, the probes and the level follow. */
export function useClaimTournament() {
  const qc = useQueryClient();
  const intent = (id: string) => `tournament:claim:${id}`;
  return useMutation({
    mutationFn: (id: string) => api<TournamentClaimResult>(`/tournaments/${id}/claim`, { method: 'POST', headers: keyFor(intent(id)) }),
    onSuccess: (r) => {
      settle(qc, r.wallet);
      refreshPieces(qc);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
      void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
      void qc.invalidateQueries({ queryKey: ME_KEY });
    },
    onError: () => void qc.invalidateQueries({ queryKey: TOURNAMENTS_KEY }),
    onSettled: (_r, error, id) => endIntent(intent(id), error),
  });
}
