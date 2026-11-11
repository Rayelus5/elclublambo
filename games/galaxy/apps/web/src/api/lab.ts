import type { LabView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { endIntent, GACHA_KEY, keyFor } from './economy';
import { syncWallet } from './wallet';

// The Laboratorio (GDD §10.6, M4b-2): its view and buying a node's next level. The level travels with the request and
// its intent's key, so a retry of a lost answer reuses it and a stale view never buys the one after; a refusal brings
// the real tree and wallet back.

export const LAB_KEY = ['lab'] as const;

export function useLab() {
  return useQuery({ queryKey: LAB_KEY, queryFn: () => api<LabView>('/lab') });
}

/** A node's next level; a seasonal node names its season (shop and lab plan, F2a: a stale view of another one is refused). */
export function useUpgradeLabNode() {
  const qc = useQueryClient();
  const intent = (v: { node: string; level: number; season?: string }) => `lab:${v.season ?? ''}:${v.node}:${v.level}`;
  return useMutation({
    mutationFn: (v: { node: string; level: number; season?: string }) =>
      api<LabView>(`/lab/nodes/${v.node}/upgrade`, { method: 'POST', body: v.season ? { level: v.level, season: v.season } : { level: v.level }, headers: keyFor(intent(v)) }),
    onSuccess: (view) => {
      qc.setQueryData(LAB_KEY, view);
      syncWallet(qc, view.wallet);
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: LAB_KEY });
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
    },
    onSettled: (_r, error, v) => endIntent(intent(v), error),
  });
}
