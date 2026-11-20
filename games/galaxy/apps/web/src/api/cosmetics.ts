import type { BackdropView, CosmeticsView, ProfileCosmeticsRequest } from '@galaxy/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// «Personalizar» (Nov plan C2): what I wear and have with the live catalog, and saving what changed. The catalog also
// tells everyone's titles their style.
export const COSMETICS_KEY = ['cosmetics'] as const;

/**
 * Something gave me pieces (a purchase, a claimed reward): what shows them reads again, at once, without a reload:
 * «Personalizar» and the Hangar, whose probes list the skins I have (plan «skins»; the owner: «debería actualizarse en
 * tiempo real»).
 */
export function refreshPieces(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: COSMETICS_KEY });
  void qc.invalidateQueries({ queryKey: ['hangar'] });
}

export function useCosmeticsView(enabled = true) {
  return useQuery({ queryKey: COSMETICS_KEY, queryFn: () => api<CosmeticsView>('/profile/cosmetics'), staleTime: 60_000, enabled });
}

/** The title screen's sky (plan «escáner pro», part E): the galaxies I chose, or my rarest. */
export const BACKDROP_KEY = ['backdrop'] as const;

export function useBackdrop() {
  return useQuery({ queryKey: BACKDROP_KEY, queryFn: () => api<BackdropView>('/profile/backdrop'), staleTime: 5 * 60_000 });
}

export function useSaveCosmetics() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ProfileCosmeticsRequest) => api<CosmeticsView>('/profile/cosmetics', { method: 'PUT', body: req }),
    onSuccess: (view) => {
      qc.setQueryData(COSMETICS_KEY, view);
      // My look shows in the top bar, my profile and the lists.
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['profile'] });
      void qc.invalidateQueries({ queryKey: BACKDROP_KEY });
    },
  });
}
