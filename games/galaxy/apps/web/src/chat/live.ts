import type { ChatChannel, LiveEvent, MeResponse, NoticeMode } from '@galaxy/shared';
import type { QueryClient } from '@tanstack/react-query';
import { addMessage, bumpUnread, CHAT_UNREAD_KEY, removeMessage } from '../api/chat';
import { ME_KEY } from '../auth/useMe';
import { pushToast } from '../live/LiveConnection';
import { getPrefs } from '../settings/prefs';
import { useUi } from '../state/ui';

// The chats on the live socket (the owner's chat asks, 2026-11-14: «notificaciones si no están abiertos los chats
// (configurable), puntos de notificaciones»). A message lands in its channel's history; one I am not reading (its
// channel not open, or the game in another tab) counts as unread and, when the player asked for it (clan, room and
// mentions by default), shows a notice saying who wrote, where and what. Comunidad's while closed only counts (the
// server sends how many every few seconds). What I read elsewhere and what a moderator took down follow too.

type ChatLiveEvent = Extract<LiveEvent, { type: 'chat' | 'chatHead' | 'chatDeleted' | 'chatRead' }>;

export const isChatEvent = (e: LiveEvent): e is ChatLiveEvent => e.type === 'chat' || e.type === 'chatHead' || e.type === 'chatDeleted' || e.type === 'chatRead';

/** Whether I am reading a channel now: its sheet open on it, in a tab I am looking at. */
export function reading(channel: ChatChannel): boolean {
  const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return visible && useUi.getState().chat === channel;
}

export function onChatEvent(qc: QueryClient, event: ChatLiveEvent, mode: NoticeMode): void {
  if (event.type === 'chatDeleted') {
    removeMessage(qc, event.channel, event.id);
    return;
  }
  if (event.type === 'chatRead') {
    // Read in another tab or device: the counts are the server's again.
    void qc.invalidateQueries({ queryKey: CHAT_UNREAD_KEY });
    return;
  }
  const notify = getPrefs().chatNotify;
  if (event.type === 'chatHead') {
    if (reading('global')) return;
    bumpUnread(qc, 'global', event.n);
    if (notify.global) pushToast({ kind: 'chatHead', username: '', n: event.n }, mode);
    return;
  }
  const m = event.message;
  addMessage(qc, m);
  const me = qc.getQueryData<MeResponse | null>(ME_KEY)?.username;
  if (m.author.username === me || reading(m.channel)) return;
  const mention = event.mention === true;
  bumpUnread(qc, m.channel, 1, mention);
  if (mention ? notify.mentions : notify[m.channel]) pushToast({ kind: 'chat', username: m.author.username, message: m, mention, n: 1 }, mode);
}
