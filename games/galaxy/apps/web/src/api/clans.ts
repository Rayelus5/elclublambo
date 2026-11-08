import type { ClanCreate, ClanEdit, ClanList, ClanView, MyClan } from '@galaxy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';
import { endIntent, GACHA_KEY, keyFor } from './economy';
import { LEADERBOARD_KEY, PROFILE_KEY } from './social';

// Clans (GDD §14.3; M5b-1): the list with its rules, one's own clan, a clan's page, creating one (an idempotent
// operation: it charges coins) and the rest of the changes, after which every clan view, the leaderboard and the
// profiles are read again.

export const CLANS_KEY = ['clans'] as const;
const retryUnlessMissing = (n: number, e: Error) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1;

export function useClans(q: string) {
  return useQuery({
    queryKey: [...CLANS_KEY, 'list', q],
    queryFn: () => api<ClanList>(q ? `/clans?q=${encodeURIComponent(q)}` : '/clans'),
    placeholderData: keepPreviousData,
  });
}

export function useMyClan() {
  return useQuery({ queryKey: [...CLANS_KEY, 'mine'], queryFn: () => api<MyClan>('/clans/mine') });
}

export function useClan(tag: string) {
  return useQuery({ queryKey: [...CLANS_KEY, 'view', tag], queryFn: () => api<ClanView>(`/clans/${encodeURIComponent(tag)}`), retry: retryUnlessMissing });
}

function useRefreshClans() {
  const qc = useQueryClient();
  return (view: ClanView | null, tag: string) => {
    if (view) qc.setQueryData([...CLANS_KEY, 'view', tag], view);
    void qc.invalidateQueries({ queryKey: CLANS_KEY });
    void qc.invalidateQueries({ queryKey: LEADERBOARD_KEY });
    void qc.invalidateQueries({ queryKey: PROFILE_KEY });
  };
}

export function useCreateClan() {
  const qc = useQueryClient();
  const refresh = useRefreshClans();
  // The whole request: a retry after a lost answer reuses the key only if nothing changed.
  const intent = (req: ClanCreate) => `clan:create:${JSON.stringify(req)}`;
  return useMutation({
    mutationFn: (req: ClanCreate) => api<ClanView>('/clans', { method: 'POST', body: req, headers: keyFor(intent(req)) }),
    onSuccess: (view) => {
      refresh(view, view.tag);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
    },
    onSettled: (_r, error, req) => endIntent(intent(req), error),
  });
}

/** A change to a clan: `path` is what follows `/clans/<tag>/` (join, request, request/cancel, leave, …). */
export function useClanAction() {
  const refresh = useRefreshClans();
  return useMutation({
    mutationFn: (v: { tag: string; path: string }) => api<ClanView | null>(`/clans/${encodeURIComponent(v.tag)}/${v.path}`, { method: 'POST' }),
    onSuccess: (view, v) => refresh(view, v.tag),
    onError: (_e, v) => refresh(null, v.tag),
  });
}

export function useEditClan() {
  const refresh = useRefreshClans();
  return useMutation({
    mutationFn: (v: { tag: string; edit: ClanEdit }) => api<ClanView>(`/clans/${encodeURIComponent(v.tag)}`, { method: 'PATCH', body: v.edit }),
    onSuccess: (view, v) => refresh(view, v.tag),
    onError: (_e, v) => refresh(null, v.tag),
  });
}
