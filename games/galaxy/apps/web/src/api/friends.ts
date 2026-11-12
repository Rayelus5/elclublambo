import type { FriendRelation, FriendsView, Presence, SocialPrefs } from '@galaxy/shared';
import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Friends (multiplayer plan, phase 3). The list comes with every answer (each action returns my whole view), the
// live socket says hello with it and pushes presence and changes; the cache below is the one source the panel, the
// top bar and the profiles read.

export const FRIENDS_KEY = ['friends'] as const;
const RELATION_KEY = 'friend-relation';

export const friendsQuery = queryOptions({ queryKey: FRIENDS_KEY, queryFn: () => api<FriendsView>('/friends'), staleTime: 60_000 });

export function useFriends(enabled = true) {
  return useQuery({ ...friendsQuery, enabled });
}

/**
 * My friends changed elsewhere (live socket: a request, an acceptance, a removal): the list is read again now, whether
 * or not a screen shows it, so it is right when one opens (the one who sent a request sees the new friend at once).
 */
export function refreshFriends(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: FRIENDS_KEY, exact: true, refetchType: 'none' });
  void qc.prefetchQuery(friendsQuery);
  void qc.invalidateQueries({ queryKey: [RELATION_KEY] });
}

/**
 * A friend's presence changed (live socket): the cached list follows, online first. Someone not in it is left to the
 * list's own refresh (a new friend's presence arrives right after the acceptance), and a write here keeps the list's
 * age and its pending refresh: presence never makes an old list count as fresh.
 */
export function setPresence(qc: QueryClient, username: string, presence: Presence): void {
  const state = qc.getQueryState<FriendsView>(FRIENDS_KEY);
  const v = state?.data;
  if (!state || !v || !v.friends.some((f) => f.username === username)) return;
  const friends = v.friends.map((f) => (f.username === username ? { ...f, presence } : f));
  friends.sort((x, y) => Number(y.presence.status === 'online') - Number(x.presence.status === 'online') || x.username.localeCompare(y.username));
  qc.setQueryData<FriendsView>(FRIENDS_KEY, { ...v, friends }, { updatedAt: state.dataUpdatedAt });
  if (state.isInvalidated) void qc.invalidateQueries({ queryKey: FRIENDS_KEY, exact: true, refetchType: 'none' });
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
