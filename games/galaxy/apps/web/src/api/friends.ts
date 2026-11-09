import type { FriendRelation, FriendsView, Presence, SocialPrefs } from '@galaxy/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Friends (multiplayer plan, phase 3). The list comes with every answer (each action returns my whole view), the
// live socket says hello with it and pushes presence and changes; the cache below is the one source the panel, the
// top bar and the profiles read.

export const FRIENDS_KEY = ['friends'] as const;
const RELATION_KEY = 'friend-relation';

export function useFriends(enabled = true) {
  return useQuery({ queryKey: FRIENDS_KEY, queryFn: () => api<FriendsView>('/friends'), staleTime: 60_000, enabled });
}

/** A friend's presence changed (live socket): the cached list follows, online first. */
export function setPresence(qc: QueryClient, username: string, presence: Presence): void {
  qc.setQueryData<FriendsView>(FRIENDS_KEY, (v) => {
    if (!v) return v;
    const friends = v.friends.map((f) => (f.username === username ? { ...f, presence } : f));
    friends.sort((x, y) => Number(y.presence.status === 'online') - Number(x.presence.status === 'online') || x.username.localeCompare(y.username));
    return { ...v, friends };
  });
}

export function useRelation(username: string, enabled = true) {
  return useQuery({
    queryKey: [RELATION_KEY, username],
    queryFn: () => api<{ relation: FriendRelation }>(`/friends/relation/${encodeURIComponent(username)}`),
    enabled,
  });
}

type Action = { kind: 'request' } | { kind: 'accept' | 'remove' | 'block' | 'unblock' };

/** Every friend action: it answers my whole view, which replaces the cache; profiles read their relation again. */
export function useFriendAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, action }: { username: string; action: Action['kind'] }) =>
      action === 'request'
        ? api<FriendsView>('/friends/requests', { method: 'POST', body: { username } })
        : api<FriendsView>(`/friends/${encodeURIComponent(username)}/${action}`, { method: 'POST' }),
    onSuccess: (view, { username }) => {
      qc.setQueryData(FRIENDS_KEY, view);
      void qc.invalidateQueries({ queryKey: [RELATION_KEY, username.toLowerCase()] });
      void qc.invalidateQueries({ queryKey: [RELATION_KEY, username] });
    },
  });
}

export function useSocialPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: SocialPrefs) => api<FriendsView>('/friends/prefs', { method: 'PUT', body: prefs }),
    onSuccess: (view) => qc.setQueryData(FRIENDS_KEY, view),
  });
}
