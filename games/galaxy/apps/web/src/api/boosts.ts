import type { BoostsView } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// The temporary global multipliers running now (GDD §16.3; M6d-5), read again every minute so one that ends goes away.

export function useBoosts() {
  return useQuery({ queryKey: ['boosts'], queryFn: () => api<BoostsView>('/boosts'), refetchInterval: 60_000, staleTime: 30_000 });
}
