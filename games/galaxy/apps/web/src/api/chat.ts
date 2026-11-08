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

export function addMessage(qc: QueryClient, m: ChatMessage): void {
  qc.setQueryData<ChatHistory>([...CHAT_KEY, m.channel], (h) =>
    !h || h.messages.some((x) => x.id === m.id) ? h : { ...h, messages: [...h.messages, m].sort(byId).slice(-KEEP) },
  );
}

export function removeMessage(qc: QueryClient, channel: ChatChannel, id: string): void {
  qc.setQueryData<ChatHistory>([...CHAT_KEY, channel], (h) => h && { ...h, messages: h.messages.filter((x) => x.id !== id) });
}

export function useChatHistory(channel: ChatChannel) {
  return useQuery({ queryKey: [...CHAT_KEY, channel], queryFn: () => api<ChatHistory>(`/chat/${channel}`), retry: false });
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
