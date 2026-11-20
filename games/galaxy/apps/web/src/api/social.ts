import type { Leaderboard, LeaderTab, Profile, PublicCollectionPage, Tier } from '@galaxy/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';

// The season leaderboard, public profiles and public collections (GDD §14.1, §14.2; M5a). A finished run refreshes
// them (api/runs.ts useFinishRun).

export const LEADERBOARD_KEY = ['leaderboard'] as const;
export const PROFILE_KEY = ['profile'] as const;

/** A name without a player answers the same the second time. */
const retryUnlessMissing = (n: number, e: Error) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 1;

/** My profile's probe showcase (plan «skins», part D): the probes in order; my profile shows them at once. */
export function useSaveProfileProbes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (probes: string[]) => api<NonNullable<Profile['probes']>>('/profile/probes', { method: 'PUT', body: { probes } }),
    onSuccess: (probes) => {
      qc.setQueriesData<Profile>({ queryKey: PROFILE_KEY }, (p) => (p && p.probes ? { ...p, probes } : p));
      void qc.invalidateQueries({ queryKey: PROFILE_KEY });
    },
  });
}

export function useLeaderboard(tab: LeaderTab) {
  return useQuery({ queryKey: [...LEADERBOARD_KEY, tab], queryFn: () => api<Leaderboard>(`/leaderboard?tab=${tab}`), staleTime: 30_000 });
}

export function useProfile(username: string) {
  return useQuery({
    queryKey: [...PROFILE_KEY, username],
    queryFn: () => api<Profile>(`/profiles/${encodeURIComponent(username)}`),
    retry: retryUnlessMissing,
  });
}

export function usePublicCollection(username: string, tier: Tier | undefined) {
  return useInfiniteQuery({
    queryKey: ['public-collection', username, tier ?? 'all'],
    queryFn: ({ pageParam }) =>
      api<PublicCollectionPage>(
        `/profiles/${encodeURIComponent(username)}/galaxies?sort=rarity&limit=30${tier ? `&tier=${tier}` : ''}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.next,
    retry: retryUnlessMissing,
  });
}
