import type { StationView } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { endIntent, keyFor } from './economy';
import { syncWallet } from './wallet';

// The station (GDD §10): its view (refreshed every minute, the refinery and the antenna move with the hour) and its
// four actions. Each action keeps its idempotency key until a real answer, so a lost request is retried with it.

export const STATION_KEY = ['station'] as const;

export function useStation() {
  return useQuery({ queryKey: STATION_KEY, queryFn: () => api<StationView>('/station'), refetchInterval: 60_000 });
}

function useStationAction<T>(intent: (v: T) => string, request: (v: T) => { path: string; body?: unknown }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: T) => {
      const { path, body } = request(v);
      return api<StationView>(`/station/${path}`, { method: 'POST', body: body ?? {}, headers: keyFor(intent(v)) });
    },
    onSuccess: (view) => {
      qc.setQueryData(STATION_KEY, view);
      // The same wallet lives in the hub's, the Laboratorio's and the Hangar's views.
      syncWallet(qc, view.wallet);
    },
    onSettled: (_r, error, v) => endIntent(intent(v), error),
  });
}

export const useLoadRefinery = () => useStationAction<number>((n) => `station:load:${n}`, (amount) => ({ path: 'refinery/load', body: { amount } }));
export const useCollectRefinery = () => useStationAction<void>(() => 'station:refinery', () => ({ path: 'refinery/collect' }));
export const useCollectAntenna = () => useStationAction<void>(() => 'station:antenna', () => ({ path: 'antenna/collect' }));
/** The level it buys travels with the request and its key, so a stale view never buys the next one. */
export const useUpgradeRoom = () =>
  useStationAction<{ id: string; level: number }>(({ id, level }) => `station:upgrade:${id}:${level}`, ({ id, level }) => ({ path: `rooms/${id}/upgrade`, body: { level } }));
