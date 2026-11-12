import type { CosmeticsView, ProfileCosmeticsRequest } from '@galaxy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// «Personalizar» (Nov plan C2): what I wear and have with the live catalog, and saving what changed. The catalog also
// tells everyone's titles their style.
export const COSMETICS_KEY = ['cosmetics'] as const;

export function useCosmeticsView(enabled = true) {
  return useQuery({ queryKey: COSMETICS_KEY, queryFn: () => api<CosmeticsView>('/profile/cosmetics'), staleTime: 60_000, enabled });
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
    },
  });
}
