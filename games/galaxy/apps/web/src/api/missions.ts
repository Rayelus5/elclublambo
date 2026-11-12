import type { MissionsView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Missions and achievements (GDD §12.3; M7a): the screen's view, collecting (with an idempotency key, like every economy
// action) and choosing the title and frame. Collecting also changes the wallet, so the hub's wallet is read again.

export const MISSIONS_KEY = ['missions'] as const;

export function useMissions() {
  return useQuery({ queryKey: MISSIONS_KEY, queryFn: () => api<MissionsView>('/missions'), refetchInterval: 120_000 });
}

export function useClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { kind: 'mission'; period: string; id: string } | { kind: 'achievement'; id: string }) =>
      api<MissionsView>(v.kind === 'mission' ? `/missions/${v.period}/${v.id}/claim` : `/achievements/${v.id}/claim`, { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() } }),
    onSuccess: (view) => {
      qc.setQueryData(MISSIONS_KEY, view);
      void qc.invalidateQueries({ queryKey: ['gacha'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

