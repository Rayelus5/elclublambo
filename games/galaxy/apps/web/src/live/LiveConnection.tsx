import type { Activity, LiveEvent, RoomInvite } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { create } from 'zustand';
import { FRIENDS_KEY, setPresence } from '../api/friends';
import { setMyRoom } from '../api/rooms';
import { useMe } from '../auth/useMe';
import { retryDelay } from '../chat/useChatSocket';

// The live socket (multiplayer plan, phase 3): open while signed in, anywhere in the game. It says hello with the
// friends list, pushes their presence and every change to it, and carries what I am doing now (the screen I am on, or
// the run and its layer, which the arena reports). A dropped socket comes back after 1, 2, 4… seconds; without a
// session, from another origin or replaced by a newer tab it stops. What arrives that a player should notice (a
// request, an acceptance, an invite to a room, being taken out of mine) goes to the toasts; my room follows the cache.
// During a run nothing pops up, and an invite that arrives then is dropped (joining would end the run).

const FINAL = new Set([4401, 4403, 4008]);

export type LiveToast =
  | { id: number; kind: 'request' | 'accepted'; username: string }
  | { id: number; kind: 'invite'; username: string; invite: RoomInvite }
  | { id: number; kind: 'kicked' | 'closed'; username: string };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type NewToast = WithoutId<LiveToast>;

type LiveState = {
  connected: boolean;
  /** The arena's report (a run and its layer); null: the screen decides. */
  run: { layer: number } | null;
  toasts: LiveToast[];
  setRun: (run: { layer: number } | null) => void;
  dismiss: (id: number) => void;
};

let toastId = 0;
export const useLive = create<LiveState>((set) => ({
  connected: false,
  run: null,
  toasts: [],
  setRun: (run) => set({ run }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

function pushToast(toast: NewToast): void {
  if (toast.kind === 'invite' && useLive.getState().run) return;
  useLive.setState((s) => ({ toasts: [...s.toasts.slice(-2), { ...toast, id: ++toastId } as LiveToast] }));
}

/** What the screen says I am doing (the arena's report wins). */
function activityOf(path: string): Activity {
  return path.startsWith('/incursion') ? 'hangar' : 'hub';
}

export function LiveConnection() {
  const me = useMe().data;
  return me ? <LiveSocket key={me.id} /> : null;
}

function LiveSocket() {
  const qc = useQueryClient();
  const path = useLocation().pathname;
  const run = useLive((s) => s.run);
  const socket = useRef<WebSocket | null>(null);
  const doing = run ? JSON.stringify({ type: 'activity', activity: 'run', layer: run.layer }) : JSON.stringify({ type: 'activity', activity: activityOf(path) });
  const latest = useRef(doing);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const connect = () => {
      const s = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/galaxy/api/live/ws`);
      socket.current = s;
      s.onopen = () => {
        attempt = 0;
        useLive.setState({ connected: true });
        s.send(latest.current);
      };
      s.onmessage = (e: MessageEvent) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(String(e.data)) as LiveEvent;
        } catch {
          return;
        }
        if (event.type === 'hello') qc.setQueryData(FRIENDS_KEY, event.friends);
        else if (event.type === 'presence') setPresence(qc, event.username, event.presence);
        else if (event.type === 'friends') {
          void qc.invalidateQueries({ queryKey: FRIENDS_KEY });
          void qc.invalidateQueries({ queryKey: ['friend-relation'] });
          if (event.reason === 'request' || event.reason === 'accepted') pushToast({ kind: event.reason, username: event.username });
        } else if (event.type === 'room') {
          setMyRoom(qc, event.room);
          if (!event.room && event.why) pushToast({ kind: event.why, username: '' });
        } else if (event.type === 'invite') pushToast({ kind: 'invite', username: event.invite.from, invite: event.invite });
      };
      s.onclose = (e: CloseEvent) => {
        socket.current = null;
        useLive.setState({ connected: false });
        if (stopped || FINAL.has(e.code)) return;
        timer = setTimeout(connect, retryDelay(attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket.current?.close();
      useLive.setState({ connected: false });
    };
  }, [qc]);

  // What I am doing, each time it changes (and for the next connection's first message).
  useEffect(() => {
    latest.current = doing;
    const s = socket.current;
    if (s && s.readyState === WebSocket.OPEN) s.send(doing);
  }, [doing]);

  return null;
}
