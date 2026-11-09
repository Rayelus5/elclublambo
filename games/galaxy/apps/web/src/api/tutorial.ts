import type { TutorialUpdate, TutorialView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The guided tutorial (GDD §12.2; polish phase 3): where the player is, and moving it (advance, skip, restart).
// Reaching the station pays components, so the wallets are read again after an update.

export const TUTORIAL_KEY = ['tutorial'] as const;

export function useTutorial(enabled = true) {
  return useQuery({ queryKey: TUTORIAL_KEY, queryFn: () => api<TutorialView>('/tutorial'), enabled, staleTime: 60_000, retry: false });
}

/** What an update leaves, before the server says so. */
function expected(v: TutorialView, body: TutorialUpdate): TutorialView {
  if (body.action === 'skip') return { ...v, status: 'skipped' };
  if (body.action === 'restart') return { ...v, status: 'active', chapter: 'hub' };
  return { ...v, chapter: body.chapter, status: body.chapter === 'done' ? 'done' : v.status };
}

export function useTutorialUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TutorialUpdate) => api<TutorialView>('/tutorial', { method: 'PUT', body }),
    // The card moves at once; the server's answer (with the gift) lands right after.
    onMutate: (body) => {
      const prev = qc.getQueryData<TutorialView>(TUTORIAL_KEY);
      if (prev) qc.setQueryData(TUTORIAL_KEY, expected(prev, body));
      return { prev };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.prev) qc.setQueryData(TUTORIAL_KEY, ctx.prev);
    },
    onSuccess: (view) => {
      qc.setQueryData(TUTORIAL_KEY, view);
      void qc.invalidateQueries({ queryKey: ['gacha'] });
      void qc.invalidateQueries({ queryKey: ['station'] });
    },
  });
}

/** The tour is running now (not skipped, not done). */
export const tourActive = (v: TutorialView | undefined) => !!v && v.status === 'active' && v.chapter !== 'done';
