import { type AdminClan, type AdminClanRow, MOD_PAGE_SIZE, type ModChannel, type ModMessage, type ModMute, type ModReportPage, type ModState } from '@galaxy/shared';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { ADMIN_KEY } from './admin';
import { api } from './client';

// Moderation (GDD §16.4; M6c-1): the report queue, every chat live, the mutes and (admins only) the clans. Every key
// sits under the panel's, so any change from the panel reads them again.

const MOD_KEY = [...ADMIN_KEY, 'mod'] as const;
export const MOD_MESSAGES_KEY = [...MOD_KEY, 'messages'] as const;
export const MOD_REPORTS_KEY = [...MOD_KEY, 'reports'] as const;

/** The panel's search over every chat (the owner's chat asks, 2026-11-14). */
export interface ModFilters {
  channel: string;
  q: string;
  author: string;
  state: ModState;
  reported: boolean;
  from: string;
  to: string;
}
export const NO_FILTERS: ModFilters = { channel: 'all', q: '', author: '', state: 'all', reported: false, from: '', to: '' };

function searchParams(f: ModFilters, before: string): string {
  const p = new URLSearchParams();
  p.set('channel', f.channel);
  if (f.q.trim().length >= 3) p.set('q', f.q.trim());
  if (f.author.trim()) p.set('author', f.author.trim().toLowerCase());
  if (f.state !== 'all') p.set('state', f.state);
  if (f.reported) p.set('reported', '1');
  if (f.from) p.set('from', new Date(f.from).toISOString());
  if (f.to) p.set('to', new Date(f.to).toISOString());
  if (before) p.set('before', before);
  return p.toString();
}

/**
 * What moderation open on screen hears on the live socket (the owner's chat asks, 2026-11-14): how many new messages
 * came to each chat since the search was read, and a tick for each new report.
 */
export const useModLive = create<{ open: boolean; fresh: Record<string, number>; reports: number }>(() => ({ open: false, fresh: {}, reports: 0 }));
export const modLiveChat = (channel: string) => useModLive.setState((s) => ({ fresh: { ...s.fresh, [channel]: (s.fresh[channel] ?? 0) + 1 } }));
export const modLiveReport = () => useModLive.setState((s) => ({ reports: s.reports + 1 }));
export const modLiveSeen = () => useModLive.setState({ fresh: {} });

export function useModChannels() {
  return useQuery({ queryKey: [...MOD_KEY, 'channels'], queryFn: () => api<ModChannel[]>('/admin/moderation/channels') });
}

/**
 * The messages that match, newest first, page after page with «Ver anteriores». Nothing is polled: the live socket
 * says when something new came, and the moderator reads it when they want.
 */
export function useModMessages(f: ModFilters) {
  return useInfiniteQuery({
    queryKey: [...MOD_MESSAGES_KEY, f],
    queryFn: ({ pageParam }) => api<ModMessage[]>(`/admin/moderation/messages?${searchParams(f, pageParam)}`),
    initialPageParam: '',
    getNextPageParam: (last) => (last.length === MOD_PAGE_SIZE ? last.at(-1)!.id : undefined),
    placeholderData: keepPreviousData,
  });
}

/** The queue a page at a time (50), the message reported most recently first. */
export function useModReports(page: number) {
  return useQuery({ queryKey: [...MOD_REPORTS_KEY, page], queryFn: () => api<ModReportPage>(`/admin/moderation/reports?page=${page}`), placeholderData: keepPreviousData });
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
