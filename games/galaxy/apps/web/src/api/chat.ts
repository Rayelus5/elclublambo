import { CHAT_UNREAD_CAP, type ChatChannel, type ChatHistory, type ChatMentionCandidate, type ChatMessage, type ChatUnread } from '@galaxy/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client';

// The chats (GDD §14.4; M5b-2): a channel's history and whether one can write in it, sending, reporting, and what
// moderators do. Every change lands in the cached history (a message once, by id), the same way the socket's events do.

export const CHAT_KEY = ['chat'] as const;
/** The most messages a channel keeps on screen in a long session. */
const KEEP = 200;
// Ids are growing integers sent as text: the shorter is older, then by digits.
const byId = (a: ChatMessage, b: ChatMessage) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const historyKey = (channel: ChatChannel) => [...CHAT_KEY, channel] as const;
/** A channel's history in the cache (the room tab resets it when the room changes). */
export const chatHistoryKey = historyKey;
// What the socket brings before a channel's first history is in: kept here until that history merges it.
const earlyKey = (channel: ChatChannel) => [...CHAT_KEY, 'early', channel] as const;
const merge = (list: ChatMessage[], more: ChatMessage[]) => {
  const fresh = more.filter((m) => !list.some((x) => x.id === m.id));
  return fresh.length ? [...list, ...fresh].sort(byId).slice(-Math.max(KEEP, list.length)) : list;
};

export function addMessage(qc: QueryClient, m: ChatMessage): void {
  if (!qc.getQueryData<ChatHistory>(historyKey(m.channel))) {
    qc.setQueryData<ChatMessage[]>(earlyKey(m.channel), (l = []) => merge(l, [m]));
    return;
  }
  qc.setQueryData<ChatHistory>(historyKey(m.channel), (h) => h && { ...h, messages: merge(h.messages, [m]) });
}

export function removeMessage(qc: QueryClient, channel: ChatChannel, id: string): void {
  qc.setQueryData<ChatHistory>(historyKey(channel), (h) => h && { ...h, messages: h.messages.filter((x) => x.id !== id) });
  qc.setQueryData<ChatMessage[]>(earlyKey(channel), (l) => l?.filter((x) => x.id !== id));
}

/**
 * A channel's history. A read replaces what was on screen, so what the socket brought while it was under way (or
 * before the first one) is merged into the answer instead of being lost.
 */
export function useChatHistory(channel: ChatChannel) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: historyKey(channel),
    queryFn: async () => {
      const before = new Set(qc.getQueryData<ChatHistory>(historyKey(channel))?.messages.map((m) => m.id));
      const h = await api<ChatHistory>(`/chat/${channel}`);
      const during = (qc.getQueryData<ChatHistory>(historyKey(channel))?.messages ?? []).filter((m) => !before.has(m.id));
      const early = qc.getQueryData<ChatMessage[]>(earlyKey(channel)) ?? [];
      qc.removeQueries({ queryKey: earlyKey(channel), exact: true });
      return { ...h, messages: merge(h.messages, [...early, ...during]) };
    },
    retry: false,
  });
}

export function useSendMessage(channel: ChatChannel) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api<ChatMessage>(`/chat/${channel}/messages`, { method: 'POST', body: { body } }),
    onSuccess: (m) => addMessage(qc, m),
    // A mute or a level the view did not know yet: read it again so the field says why.
    onError: (e) => {
      if (e instanceof ApiError && (e.code === 'chat_muted' || e.code === 'chat_level')) void qc.invalidateQueries({ queryKey: [...CHAT_KEY, channel] });
    },
  });
}

type Target = { id: string; channel: ChatChannel };
const goneIfMissing = (qc: QueryClient, e: Error, v: Target) => {
  if (e instanceof ApiError && e.code === 'message_not_found') removeMessage(qc, v.channel, v.id);
};

export function useReportMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Target) => api<{ hidden: boolean }>(`/chat/messages/${v.id}/report`, { method: 'POST', body: {} }),
    onSuccess: (r, v) => r.hidden && removeMessage(qc, v.channel, v.id),
    onError: (e, v) => goneIfMissing(qc, e, v),
  });
}

export function useHideMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: Target) => api<{ hidden: true }>(`/chat/messages/${v.id}/hide`, { method: 'POST' }),
    onSuccess: (_r, v) => removeMessage(qc, v.channel, v.id),
    onError: (e, v) => goneIfMissing(qc, e, v),
  });
}

/** Moderators: the account cannot write for an hour. */
export const MUTE_MINUTES = 60;

export function useMuteAccount() {
  return useMutation({
    mutationFn: (v: { username: string; reason: string }) => api<{ until: string }>('/chat/mutes', { method: 'POST', body: { username: v.username, minutes: MUTE_MINUTES, reason: v.reason } }),
  });
}

// The owner's chat asks (2026-11-14): what is new in each channel (the server counts it; the live socket keeps it up
// to date between reads), what I read, older messages on demand, and names for the mention box.

export const CHAT_UNREAD_KEY = [...CHAT_KEY, 'unread'] as const;
const EMPTY_UNREAD: ChatUnread = { global: 0, clan: null, room: null, mentions: { global: 0, clan: 0, room: 0 } };

export function useChatUnread(enabled = true) {
  return useQuery({ queryKey: CHAT_UNREAD_KEY, queryFn: () => api<ChatUnread>('/chat/unread'), enabled, staleTime: 60_000, retry: false });
}

/** All my channels' unread messages together, and whether any names me (the top bar's button). */
export function unreadTotal(u: ChatUnread | undefined): { n: number; mentions: number } {
  if (!u) return { n: 0, mentions: 0 };
  return { n: Math.min(CHAT_UNREAD_CAP, u.global + (u.clan ?? 0) + (u.room ?? 0)), mentions: u.mentions.global + u.mentions.clan + u.mentions.room };
}

/** One more unread message in a channel (and one more naming me, `mention`), as the live socket brings it. */
export function bumpUnread(qc: QueryClient, channel: ChatChannel, by = 1, mention = false): void {
  qc.setQueryData<ChatUnread>(CHAT_UNREAD_KEY, (u = EMPTY_UNREAD) => ({
    ...u,
    [channel]: Math.min(CHAT_UNREAD_CAP, (u[channel] ?? 0) + by),
    mentions: mention ? { ...u.mentions, [channel]: Math.min(CHAT_UNREAD_CAP, u.mentions[channel] + 1) } : u.mentions,
  }));
}

/** A channel read to its end here: nothing new in it. */
export function clearUnread(qc: QueryClient, channel: ChatChannel): void {
  qc.setQueryData<ChatUnread>(CHAT_UNREAD_KEY, (u) => u && { ...u, [channel]: u[channel] === null ? null : 0, mentions: { ...u.mentions, [channel]: 0 } });
}

/** I read a channel up to a message: the server keeps it (only forward) and my other tabs learn it. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { channel: ChatChannel; id: string }) => api<{ id: string }>('/chat/read', { method: 'POST', body: v }),
    onMutate: (v) => clearUnread(qc, v.channel),
  });
}

/** The messages before the oldest on screen (one page), added to the channel's history. */
export function useOlderMessages(channel: ChatChannel) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (before: string) => api<ChatHistory>(`/chat/${channel}?before=${before}`),
    onSuccess: (older) =>
      qc.setQueryData<ChatHistory>(historyKey(channel), (h) => {
        if (!h) return h;
        const known = new Set(h.messages.map((m) => m.id));
        return { ...h, messages: [...older.messages.filter((m) => !known.has(m.id)), ...h.messages].sort(byId) };
      }),
  });
}

/** Players whose name starts like this (two letters at least), for the mention box. */
export function searchMentionNames(q: string): Promise<ChatMentionCandidate[]> {
  return api<{ players?: ChatMentionCandidate[] }>(`/chat/mentions?q=${encodeURIComponent(q)}`).then((r) => (Array.isArray(r.players) ? r.players : []));
}

/** Someone I just blocked: their messages leave every channel on screen, and the counts are read again. */
export function dropAuthor(qc: QueryClient, username: string): void {
  for (const channel of ['global', 'clan', 'room'] as const) {
    qc.setQueryData<ChatHistory>(historyKey(channel), (h) => h && { ...h, messages: h.messages.filter((m) => m.author.username !== username) });
  }
  void qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY });
}
