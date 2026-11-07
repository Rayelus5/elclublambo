import type { PlanetariumView, PlanetariumVisit } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';
import { COLLECTION_KEY } from './economy';

// The planetarium (GDD §10.5, §14.2; M4c-2): one's own planetarium, what each pedestal holds (the whole row is sent,
// like the hangar's loadout: it moves no currency) and a visit to someone else's by name.

export const PLANETARIUM_KEY = ['planetarium'] as const;

export function usePlanetarium() {
  return useQuery({ queryKey: PLANETARIUM_KEY, queryFn: () => api<PlanetariumView>('/planetarium') });
}

export function useSetExhibits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (galaxies: (string | null)[]) => api<PlanetariumView>('/planetarium/exhibits', { method: 'PUT', body: { galaxies } }),
    onSuccess: (view) => {
      qc.setQueryData(PLANETARIUM_KEY, view);
      // The collection marks what is on display, and a galaxy's detail says whether it can be disintegrated.
      void qc.invalidateQueries({ queryKey: COLLECTION_KEY });
      void qc.invalidateQueries({ queryKey: ['galaxy'] });
    },
    onError: () => void qc.invalidateQueries({ queryKey: PLANETARIUM_KEY }),
  });
}

export function useVisit(username: string) {
  return useQuery({
    queryKey: [...PLANETARIUM_KEY, 'visit', username],
    queryFn: () => api<PlanetariumVisit>(`/planetarium/visit/${encodeURIComponent(username)}`),
    // A name without a planetarium answers the same the second time.
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1,
  });
}
