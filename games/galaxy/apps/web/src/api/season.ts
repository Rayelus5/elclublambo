import type { SeasonView } from '@galaxy/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// The player's season (GDD §13.1): its route, its shop and the last season's closing prizes. The season screen and the
// home's «Tienda de temporada» read the same query, so what is collected there clears the home's dot at once.

export const SEASON_KEY = ['season'] as const;

export function useSeasonView(opts: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: SEASON_KEY, queryFn: () => api<SeasonView>('/season'), enabled: opts.enabled ?? true });
}

/** What waits to be collected (the owner, 2026-11-24): the steps reached and not collected, and the closing prizes. */
export function seasonToCollect(v: SeasonView | undefined): number {
  if (!v) return 0;
  const steps = v.steps.filter((s) => s.reached && !s.claimed).length;
  const closing = v.closing && !v.closing.claimed && v.closing.rewards.length > 0 ? 1 : 0;
  return steps + closing;
}
