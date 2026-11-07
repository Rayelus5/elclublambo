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

/** Picks one of the open sectors for the next runs; the hangar comes back with it. */
export function useChooseSector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sector: string) => api<HangarView>('/hangar/sector', { method: 'PUT', body: { sector } }),
    onSuccess: (view) => qc.setQueryData(HANGAR_KEY, view),
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

/**
 * Buys the probe's next level (GDD §6, M4b-1), naming it: the intent's key travels with the level, so a retry of a lost
 * answer reuses it and a stale view never buys the one after. The wallet (components, coins) is refreshed.
 */
export function useLevelUpProbe() {
  const qc = useQueryClient();
  const intent = (v: { probe: string; level: number }) => `hangar:level:${v.probe}:${v.level}`;
  return useMutation({
    mutationFn: (v: { probe: string; level: number }) =>
      api<HangarView>(`/hangar/probes/${v.probe}/level-up`, { method: 'POST', body: { level: v.level }, headers: keyFor(intent(v)) }),
    onSuccess: (view) => {
      qc.setQueryData(HANGAR_KEY, view);
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
    },
    // A refusal (another tab levelled it, the wallet changed) brings the real level and balance, so the next click is right.
    onError: () => {
      void qc.invalidateQueries({ queryKey: HANGAR_KEY });
      void qc.invalidateQueries({ queryKey: GACHA_KEY });
    },
    onSettled: (_r, error, v) => endIntent(intent(v), error),
  });
}

/** The probe's starting weapon: its base or a variant its level opens. */
export function useChooseVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { probe: string; variant: string }) => api<HangarView>(`/hangar/probes/${v.probe}/variant`, { method: 'PUT', body: { variant: v.variant } }),
    onSuccess: (view) => qc.setQueryData(HANGAR_KEY, view),
    onError: () => void qc.invalidateQueries({ queryKey: HANGAR_KEY }),
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
