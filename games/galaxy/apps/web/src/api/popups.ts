import type { PopupAnswerInput, PopupAnswerResult, PopupNext } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ME_KEY } from '../auth/useMe';
import { api } from './client';
import { refreshPieces } from './cosmetics';
import { COLLECTION_KEY, endIntent, GACHA_KEY, keyFor } from './economy';
import { syncWallet } from './wallet';

// «Encuestas y avisos» for players (GDD §16.5; plan 2026-11-22, part A): which popup the title screen shows, and what
// the player does with it. Reading never spends a show (the server counts one on `shown`); «Más tarde» brings it back
// another day; a promotion is closed, through «Ver más» or not; answers go once, with the intent's idempotency key
// until a real answer comes back, and a reward lands in the wallet, the pieces and the collection at once.

export const POPUP_NEXT_KEY = ['popups', 'next'] as const;

/** The popup to show now, read only while the title screen is ready for it (`enabled`); always asked afresh. */
export function usePopupNext(enabled: boolean) {
  return useQuery({ queryKey: POPUP_NEXT_KEY, queryFn: () => api<PopupNext>('/popups/next'), enabled, staleTime: 0, refetchOnWindowFocus: false, retry: false });
}

/** The popup opened: the server counts the show (three at most, never two in a day). */
export function usePopupShown() {
  return useMutation({ mutationFn: (id: string) => api<void>(`/popups/${id}/shown`, { method: 'POST' }) });
}

/** «Más tarde»: it comes back in another session. */
export function usePopupLater() {
  return useMutation({ mutationFn: (id: string) => api<void>(`/popups/${id}/later`, { method: 'POST' }) });
}

/** A promotion closed, through «Ver más» (`clicked`) or not: it never comes back. */
export function usePopupSeen() {
  return useMutation({ mutationFn: (v: { id: string; clicked: boolean }) => api<void>(`/popups/${v.id}/seen`, { method: 'POST', body: { clicked: v.clicked } }) });
}

const answerIntent = (id: string) => `popup-answer:${id}`;

/** Sends a campaign's answers; what the reward gave comes back (null: no reward) with the new wallet. */
export function usePopupAnswer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; answers: PopupAnswerInput[] }) =>
      api<PopupAnswerResult>(`/popups/${v.id}/answer`, { method: 'POST', body: { answers: v.answers }, headers: keyFor(answerIntent(v.id)) }),
    onSuccess: (r) => {
      syncWallet(qc, r.wallet);
      if (!r.granted || r.granted.length === 0) return;
      // A gift can be a piece, a galaxy, a probe or experience: everything that shows them reads again.
      refreshPieces(qc);
      for (const key of [GACHA_KEY, COLLECTION_KEY, ME_KEY]) void qc.invalidateQueries({ queryKey: key });
    },
    onSettled: (_r, error, v) => endIntent(answerIntent(v.id), error),
  });
}
