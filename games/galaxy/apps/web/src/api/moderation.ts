import { type AdminClan, type AdminClanRow, MOD_PAGE_SIZE, type ModChannel, type ModMessage, type ModMute, type ModReport } from '@galaxy/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// Moderation (GDD §16.4; M6c-1): the report queue, every chat live, the mutes and (admins only) the clans. Every key
// sits under the panel's, so any change from the panel reads them again.

const MOD_KEY = [...ADMIN_KEY, 'mod'] as const;
/** How often the live chat reads its channel again while it is not paused. */
export const LIVE_MS = 5000;

export function useModChannels() {
  return useQuery({ queryKey: [...MOD_KEY, 'channels'], queryFn: () => api<ModChannel[]>('/admin/moderation/channels') });
}

/**
 * A channel's messages, newest first, page after page with «Ver anteriores». While live, every page is read again
 * every 5 s (TanStack reads them in order from the first, so a page never starts from a stale cursor).
 */
export function useModMessages(channel: string, live: boolean) {
  return useInfiniteQuery({
    queryKey: [...MOD_KEY, 'messages', channel],
    queryFn: ({ pageParam }) => api<ModMessage[]>(`/admin/moderation/messages?channel=${encodeURIComponent(channel)}${pageParam ? `&before=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.length === MOD_PAGE_SIZE ? last.at(-1)!.id : undefined),
    refetchInterval: live ? LIVE_MS : false,
  });
}

export function useModReports() {
  return useQuery({ queryKey: [...MOD_KEY, 'reports'], queryFn: () => api<ModReport[]>('/admin/moderation/reports') });
}

export function useModMutes() {
  return useQuery({ queryKey: [...MOD_KEY, 'mutes'], queryFn: () => api<ModMute[]>('/admin/moderation/mutes') });
}

export function useAdminClans(q: string) {
  return useQuery({
    queryKey: [...ADMIN_KEY, 'clans', q],
    queryFn: () => api<AdminClanRow[]>(`/admin/clans${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    placeholderData: keepPreviousData,
  });
}

export function useAdminClan(tag: string) {
  return useQuery({ queryKey: [...ADMIN_KEY, 'clan', tag], queryFn: () => api<AdminClan>(`/admin/clans/${encodeURIComponent(tag)}`), retry: false });
}
