import type { ChatEvent } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { addMessage, CHAT_KEY, removeMessage } from '../api/chat';

// The chats' socket (M5b-2) while the sheet is open: it only listens. Each new message lands in its channel's history
// once (by id) and a message taken down leaves it. A dropped socket comes back after 1, 2, 4… seconds (30 at most) and
// reads the channels again, for what came while it was away; without a session or from another origin it stops.

export const retryDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
const FINAL = new Set([4401, 4403]);

/** True while the socket is down and coming back. */
export function useChatSocket(): boolean {
  const qc = useQueryClient();
  const [down, setDown] = useState(false);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    let first = true;
    const connect = () => {
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/galaxy/api/chat/ws`);
      socket = s;
      s.onopen = () => {
        attempt = 0;
        setDown(false);
        if (!first) void qc.invalidateQueries({ queryKey: CHAT_KEY });
        first = false;
      };
      s.onmessage = (e: MessageEvent) => {
        let event: ChatEvent;
        try {
          event = JSON.parse(String(e.data)) as ChatEvent;
        } catch {
          return;
        }
        if (event.type === 'message') addMessage(qc, event.message);
        else if (event.type === 'deleted') removeMessage(qc, event.channel, event.id);
      };
      s.onclose = (e: CloseEvent) => {
        socket = null;
        if (stopped || FINAL.has(e.code)) return;
        first = false;
        setDown(true);
        timer = setTimeout(connect, retryDelay(attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [qc]);
  return down;
}
