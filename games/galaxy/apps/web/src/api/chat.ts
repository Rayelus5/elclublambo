import type { ChatChannel, ChatHistory, ChatMessage } from '@galaxy/shared';
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
  return fresh.length ? [...list, ...fresh].sort(byId).slice(-KEEP) : list;
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
