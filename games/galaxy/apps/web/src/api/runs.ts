import type { GachaView, HangarView, ProbeTestRequest, ProbeTestResult, RunResult, RunStart, StartRunRequest } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { COLLECTION_KEY, endIntent, GACHA_KEY, keyFor } from './economy';
import { clearPending, type PendingRun } from './pending-run';

// The hangar and the runs as the client sees them (GDD §5.1, §11.3 bis). Starting a run is one intent (one key until
// it is answered); finishing one carries the key saved with the pending result, so a retry is always the same request.

export const HANGAR_KEY = ['hangar'] as const;

export function useHangar() {
  return useQuery({ queryKey: HANGAR_KEY, queryFn: () => api<HangarView>('/hangar'), staleTime: 10_000 });
}

export function useSetLoadout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (relics: (string | null)[]) => api<HangarView>('/hangar/loadout', { method: 'PUT', body: { relics } }),
    onSuccess: (view) => {
      qc.setQueryData(HANGAR_KEY, view);
      void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
    },
  });
}

/** Picks one of the unlocked probes for the next runs; the hangar comes back with it. */
export function useChooseProbe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (probe: string) => api<HangarView>('/hangar/probe', { method: 'PUT', body: { probe } }),
    onSuccess: (view) => qc.setQueryData(HANGAR_KEY, view),
  });
}

/** The probe test, sent once at the end (GDD §6). The hangar is refreshed: it now has its probe. */
export function useProbeTest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ProbeTestRequest) => api<ProbeTestResult>('/probe-test', { method: 'POST', body: req }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: HANGAR_KEY }),
  });
}

export function useStartRun() {
  return useMutation({
    mutationFn: (req: StartRunRequest) => api<RunStart>('/runs', { method: 'POST', body: req, headers: keyFor('run-start') }),
    onSettled: (_data, error) => endIntent('run-start', error),
  });
}

export function finishRun(p: PendingRun): Promise<RunResult> {
  return api<RunResult>(`/runs/${p.runId}/finish`, { method: 'POST', body: p.body, headers: { 'idempotency-key': p.key } });
}

/** Sends a finished run; on an answer (paid or refused) the pending copy is dropped and the wallet refreshed. */
export function useFinishRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: finishRun,
    onSuccess: (r) => {
      clearPending();
      qc.setQueryData<GachaView>(GACHA_KEY, (old) => (old ? { ...old, wallet: r.wallet } : old));
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
      void qc.invalidateQueries({ queryKey: HANGAR_KEY });
    },
  });
}
