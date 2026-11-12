import type { Activity, FriendsView, LiveEvent, LiveNotice, NoticeMode, RoomInvite, RunResult } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { create } from 'zustand';
import { FRIENDS_KEY, refreshFriends, setPresence } from '../api/friends';
import { setMyRoom } from '../api/rooms';
import { settleWallet, SHOP_KEY } from '../api/shop';
import { CLANS_KEY } from '../api/clans';
import { MAILBOX_KEY } from '../api/mail';
import { TRADES_KEY } from '../api/trades';
import { useMe } from '../auth/useMe';
import { retryDelay } from '../chat/useChatSocket';
import { applyNotice } from './notices';

// The live socket (multiplayer plan, phase 3): open while signed in, anywhere in the game. It says hello with the
// friends list, pushes their presence and every change to it, and carries what I am doing now (the screen I am on, or
// the run and its layer, which the arena reports). A dropped socket comes back after 1, 2, 4… seconds; without a
// session, from another origin or replaced by a newer tab it stops. What arrives that a player should notice (a
// request, an acceptance, an invite to a room, being taken out of mine, and (real-time notices plan) a trade, a sale, a
// mail, my clan, an achievement) goes to the toasts, unless the player chose «Silencio»; what it touches is read again
// either way. During a run the toasts wait for it to end, and an invite that arrives then is dropped (joining would end
// the run).

const FINAL = new Set([4401, 4403, 4008]);

export type LiveToast =
  | { id: number; kind: 'request' | 'accepted'; username: string }
  | { id: number; kind: 'invite'; username: string; invite: RoomInvite }
  | { id: number; kind: 'kicked' | 'closed'; username: string }
  /** A group run I had left ended (phase 6c): what it paid me. */
  | { id: number; kind: 'coopResult'; username: string; result: RunResult }
  /** Something happened to me elsewhere (real-time notices plan): a trade, a sale, a mail, my clan, an achievement. */
  | { id: number; kind: 'notice'; username: string; notice: LiveNotice };
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;
type NewToast = WithoutId<LiveToast>;

type LiveState = {
  connected: boolean;
  /** The arena's report (a run and its layer); null: the screen decides. */
  run: { layer: number } | null;
  toasts: LiveToast[];
  /** The result open on screen (a group run I had left), or null. */
  shownResult: RunResult | null;
  /** The mailbox opened from a notice. */
  shownMail: boolean;
  setRun: (run: { layer: number } | null) => void;
  dismiss: (id: number) => void;
};

let toastId = 0;
export const useLive = create<LiveState>((set) => ({
  connected: false,
  run: null,
  toasts: [],
  shownResult: null,
  shownMail: false,
  setRun: (run) => set({ run }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** How many toasts wait at most (three show at a time; the oldest beyond it are dropped). */
const QUEUE = 8;

/** A toast in the queue, unless the player silenced notices; an invite during a run is dropped (joining would end it). */
export function pushToast(toast: NewToast, mode: NoticeMode = 'sound'): void {
  if (mode === 'off') return;
  if (toast.kind === 'invite' && useLive.getState().run) return;
  useLive.setState((s) => ({ toasts: [...s.toasts.slice(-(QUEUE - 1)), { ...toast, id: ++toastId } as LiveToast] }));
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
  const navigate = useNavigate();
  const go = useRef(navigate);
  useEffect(() => {
    go.current = navigate;
  }, [navigate]);
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
      // The player's choice for notices (the friends view carries it; with sound until it is known).
      const mode = (): NoticeMode => qc.getQueryData<FriendsView>(FRIENDS_KEY)?.prefs.notices ?? 'sound';
      const toast = (t: NewToast) => pushToast(t, mode());
      s.onmessage = (e: MessageEvent) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(String(e.data)) as LiveEvent;
        } catch {
          return;
        }
        if (event.type === 'hello') {
          qc.setQueryData(FRIENDS_KEY, event.friends);
          // Back after a drop: what may have changed meanwhile is read again where it shows.
          for (const key of [TRADES_KEY, MAILBOX_KEY, [...CLANS_KEY, 'mine']]) void qc.invalidateQueries({ queryKey: key });
        }
        else if (event.type === 'presence') setPresence(qc, event.username, event.presence);
        else if (event.type === 'friends') {
          refreshFriends(qc);
          if (event.reason === 'request' || event.reason === 'accepted') toast({ kind: event.reason, username: event.username });
        } else if (event.type === 'room') {
          setMyRoom(qc, event.room);
          // The leader launched: whoever is elsewhere (not in a run) goes to the room, which is the run now.
          if (event.room?.run && !useLive.getState().run && !window.location.pathname.endsWith('/incursion')) void go.current('/incursion');
          if (!event.room && event.why) toast({ kind: event.why, username: '' });
        } else if (event.type === 'invite') toast({ kind: 'invite', username: event.invite.from, invite: event.invite });
        else if (event.type === 'coopResult') toast({ kind: 'coopResult', username: '', result: event.result });
        else if (event.type === 'notice') {
          applyNotice(qc, event.notice);
          toast({ kind: 'notice', username: '', notice: event.notice });
        }
        else if (event.type === 'purchase') {
          // A purchase of the shop delivered (shop and lab plan, F5): its wallet everywhere, and the purchase itself
          // for the payment dialog waiting on it.
          settleWallet(qc, event.purchase.wallet);
          qc.setQueryData(['shop-purchase', event.purchase.id], event.purchase);
          void qc.invalidateQueries({ queryKey: SHOP_KEY });
        }
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
