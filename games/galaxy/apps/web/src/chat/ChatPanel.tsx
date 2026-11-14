import { type ChatChannel, type ChatHistory, type ChatMessage, type FriendsView, type MeResponse, mentionsIn } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { chatHistoryKey, dropAuthor, useChatHistory, useChatUnread, useHideMessage, useMarkRead, useMuteAccount, useOlderMessages, useReportMessage } from '../api/chat';
import { ApiError } from '../api/client';
import { useMyClan } from '../api/clans';
import { FRIENDS_KEY } from '../api/friends';
import { useRooms } from '../api/rooms';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { useLive } from '../live/LiveConnection';
import { BlockConfirm } from '../social/BlockConfirm';
import { useUi } from '../state/ui';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ChatMessageItem } from './ChatMessageItem';
import { Composer } from './Composer';

const t = copy.chat;

/** The sheet while signed in and open; it closes itself when the session ends. */
export function ChatHost() {
  const me = useMe().data;
  const channel = useUi((s) => s.chat);
  const close = useUi((s) => s.closeChat);
  useEffect(() => {
    if (!me && channel) close();
  }, [me, channel, close]);
  return me && channel ? <ChatPanel me={me} channel={channel} onClose={close} /> : null;
}

type Pending = { kind: 'report' | 'mute' | 'block'; m: ChatMessage } | null;

/**
 * The chat (GDD §14.4; DESIGN_SYSTEM §8 terdecies; the owner's chat asks, 2026-11-14): a side sheet that does not
 * block the game (a non-modal dialog), or the whole screen when asked. Focus goes to the field (or to the tabs when one
 * cannot write) and back to whatever opened it; Escape closes it. Tabs for Comunidad and, with a clan or a room, Clan
 * and Sala, each with what is unread in it; the live socket keeps the open channel up to date.
 */
function ChatPanel({ me, channel, onClose }: { me: MeResponse; channel: ChatChannel; onClose: () => void }) {
  const titleId = useId();
  const panelId = useId();
  const sheet = useRef<HTMLDivElement>(null);
  const mine = useMyClan();
  const rooms = useRooms();
  const room = rooms.data?.mine ?? null;
  const openChat = useUi((s) => s.openChat);
  // One left their clan (or their room) with its tab open: back to Comunidad.
  const active: ChatChannel = (channel === 'clan' && mine.isSuccess && !mine.data) || (channel === 'room' && rooms.isSuccess && !room) ? 'global' : channel;
  const tabs: ChatChannel[] = ['global', ...(mine.data ? (['clan'] as const) : []), ...(room ? (['room'] as const) : [])];
  // Another room is another conversation: the room tab reads it afresh.
  const roomId = room?.id ?? null;
  const qc = useQueryClient();
  const lastRoom = useRef(roomId);
  useEffect(() => {
    if (lastRoom.current === roomId) return;
    lastRoom.current = roomId;
    void qc.resetQueries({ queryKey: chatHistoryKey('room') });
  }, [roomId, qc]);
  const history = useChatHistory(active);
  const unread = useChatUnread().data;
  const dropped = useLive((s) => s.dropped);
  const report = useReportMessage();
  const hide = useHideMessage();
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const actionError = report.error ?? hide.error;

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheet.current?.focus();
    return () => before?.focus();
  }, []);
  // Once the first history is in: to the field, or to the tabs when one cannot write.
  const placed = useRef(false);
  const loaded = history.data !== undefined;
  useEffect(() => {
    const node = sheet.current;
    if (!loaded || placed.current || !node || !node.contains(document.activeElement)) return;
    placed.current = true;
    (node.querySelector<HTMLElement>('textarea:not(:disabled)') ?? node.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
  }, [loaded]);

  // A message taken away with the focus on one of its buttons (reported, hidden): the focus stays in the sheet, on the
  // list, instead of falling to the page. A click elsewhere leaves that element in place, so it never pulls focus back.
  const lastFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const gone = lastFocus.current !== null && !lastFocus.current.isConnected;
    if (!gone || (document.activeElement && document.activeElement !== document.body)) return;
    const log = sheet.current?.querySelector<HTMLElement>('[role="log"]') ?? sheet.current;
    lastFocus.current = log ?? null;
    log?.focus();
  });

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>): void {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tabs[(tabs.indexOf(active) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
    openChat(next);
    sheet.current?.querySelector<HTMLElement>(`[data-channel="${next}"]`)?.focus();
  }

  function confirmReport(): void {
    if (!pending) return;
    const m = pending.m;
    setPending(null);
    report.mutate({ id: m.id, channel: m.channel }, { onSuccess: () => setReported((s) => new Set(s).add(m.id)) });
  }

  const isFriend = (u: string) => qc.getQueryData<FriendsView>(FRIENDS_KEY)?.friends.some((f) => f.username === u) ?? false;

  return createPortal(
    <div
      ref={sheet}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`lip panel chat-sheet${full ? ' full' : ''}`}
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        lastFocus.current = e.target;
      }}
    >
      <header className="chat-top">
        <h2 id={titleId}>{t.title}</h2>
        <span className="chat-status" role="status">
          {dropped ? t.reconnecting : notice}
        </span>
        <button type="button" className="lip iconbtn small chat-full" aria-pressed={full} aria-label={full ? t.exitFullscreen : t.fullscreen} title={full ? t.exitFullscreen : t.fullscreen} onClick={() => setFull((f) => !f)}>
          <Icon name="display" />
        </button>
        <button type="button" className="lip iconbtn small" aria-label={t.close} title={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="tabs chat-tabs" role="tablist" aria-label={t.channels}>
        {tabs.map((c) => {
          const n = c === active ? 0 : (unread?.[c] ?? 0);
          const named = c === active ? 0 : (unread?.mentions[c] ?? 0);
          return (
            <button
              key={c}
              type="button"
              role="tab"
              data-channel={c}
              aria-selected={c === active}
              aria-controls={panelId}
              aria-label={t.tabLabel(t[c], n, named)}
              tabIndex={c === active ? 0 : -1}
              onClick={() => openChat(c)}
              onKeyDown={onTabKey}
            >
              {t[c]}
              {n > 0 ? (
                <span className={`chat-unread${named > 0 ? ' mention' : ''}`} aria-hidden="true">
                  {named > 0 ? '@' : n > 99 ? '99+' : n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div id={panelId} role="tabpanel" aria-label={t[active]} className="chat-channel">
        {history.data ? (
          <>
            <MessageLog
              key={active}
              channel={active}
              history={history.data}
              me={me.username}
              reported={reported}
              busy={hide.isPending}
              onReport={(m) => setPending({ kind: 'report', m })}
              onHide={(m) => hide.mutate({ id: m.id, channel: m.channel })}
              onMute={(m) => setPending({ kind: 'mute', m })}
              onBlock={(m) => setPending({ kind: 'block', m })}
            />
            {actionError && !(actionError instanceof ApiError && actionError.code === 'message_not_found') ? (
              <p className="field-error" role="alert">
                {errorText(actionError, copy.errors)}
              </p>
            ) : null}
            <Composer key={`compose-${active}`} channel={active} history={history.data} me={me.username} />
          </>
        ) : history.error ? (
          <p className="field-error" role="alert">
            {errorText(history.error, copy.errors)}
          </p>
        ) : (
          <p className="chat-loading" role="status">
            {t.loading}
          </p>
        )}
      </div>
      {pending?.kind === 'report' ? (
        <Dialog title={t.reportTitle} role="alertdialog" className="chat-confirm" onClose={() => setPending(null)}>
          <blockquote className="chat-quote">
            <b>{pending.m.author.username}</b>
            <span>{pending.m.body}</span>
          </blockquote>
          <p className="panel-note">{t.reportBody}</p>
          <div className="confirm-actions">
            <button type="button" className="lip pill" data-autofocus onClick={() => setPending(null)}>
              {t.cancel}
            </button>
            <button type="button" className="lip pill danger" onClick={confirmReport}>
              {t.report}
            </button>
          </div>
        </Dialog>
      ) : pending?.kind === 'mute' ? (
        <MuteDialog
          username={pending.m.author.username}
          onClose={() => setPending(null)}
          onDone={(u) => {
            setPending(null);
            setNotice(t.mutedDone(u));
          }}
        />
      ) : pending?.kind === 'block' ? (
        <BlockConfirm
          username={pending.m.author.username}
          friend={isFriend(pending.m.author.username)}
          onClose={() => setPending(null)}
          onDone={() => {
            const u = pending.m.author.username;
            dropAuthor(qc, u);
            setNotice(t.blockedDone(u));
          }}
        />
      ) : null}
    </div>,
    document.body,
  );
}

/** A message's day, in this browser's time. */
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long' });
const dayYearFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
/** «Hoy», «Ayer» or the date (with its year when it is not this one). */
function dayLabel(iso: string): string {
  const now = new Date();
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return t.today;
  if (key === dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString())) return t.yesterday;
  const d = new Date(iso);
  return (d.getFullYear() === now.getFullYear() ? dayFmt : dayYearFmt).format(d);
}
/** Messages of one author this close together read as one. */
const GROUP_MS = 5 * 60_000;
const NEAR_BOTTOM = 48;

/**
 * The channel's messages, oldest first, split by day and grouped by author; it stays at the bottom while one is
 * reading the latest, and says how many came while one reads further up. «Ver anteriores» brings the page before (the
 * place on screen kept). What is on screen at the bottom counts as read (a moment later; never in a hidden tab).
 */
function MessageLog({
  channel,
  history,
  me,
  reported,
  busy,
  onReport,
  onHide,
  onMute,
  onBlock,
}: {
  channel: ChatChannel;
  history: ChatHistory;
  me: string;
  reported: ReadonlySet<string>;
  busy: boolean;
  onReport: (m: ChatMessage) => void;
  onHide: (m: ChatMessage) => void;
  onMute: (m: ChatMessage) => void;
  onBlock: (m: ChatMessage) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  // The newest message when one left the bottom: what came after it is «new below».
  const [leftAt, setLeftAt] = useState<string | null>(null);
  const [noMore, setNoMore] = useState(false);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const anchor = useRef<number | null>(null);
  const older = useOlderMessages(channel);
  const markRead = useMarkRead();
  const sent = useRef<string | null>(null);
  const messages = history.messages;
  const last = messages.at(-1)?.id ?? null;

  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    // Older messages came in on top: the ones on screen stay where they were.
    if (anchor.current !== null) {
      el.scrollTop = el.scrollHeight - anchor.current;
      anchor.current = null;
      return;
    }
    if (stuck.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  // A smaller window keeps the latest message in sight too.
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);
  // Read up to the newest on screen, a moment after it shows (once per message).
  useEffect(() => {
    if (!atBottom || !visible || !last || sent.current === last) return;
    const timer = setTimeout(() => {
      sent.current = last;
      markRead.mutate({ channel, id: last });
    }, 600);
    return () => clearTimeout(timer);
  }, [atBottom, visible, last, channel, markRead]);

  const below = atBottom || !leftAt ? 0 : messages.filter((m) => m.id.length > leftAt.length || (m.id.length === leftAt.length && m.id > leftAt)).filter((m) => m.author.username !== me).length;
  const toBottom = () => {
    const el = list.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setAtBottom(true);
    setLeftAt(null);
  };

  return (
    <div className="chat-log-wrap">
      <ol
        ref={list}
        role="log"
        aria-label={t.messages}
        className="chat-log"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
          stuck.current = bottom;
          if (bottom !== atBottom) {
            setAtBottom(bottom);
            setLeftAt(bottom ? null : last);
          }
        }}
      >
        {messages.length > 0 ? (
          <li className="chat-older">
            {noMore ? (
              <span className="chat-older-none">{t.noOlder}</span>
            ) : (
              <button
                type="button"
                className="lip pill small"
                disabled={older.isPending}
                aria-busy={older.isPending || undefined}
                onClick={() => {
                  const el = list.current;
                  if (el) anchor.current = el.scrollHeight - el.scrollTop;
                  older.mutate(messages[0]!.id, { onSuccess: (h) => h.messages.length === 0 && setNoMore(true), onError: () => (anchor.current = null) });
                }}
              >
                {older.isPending ? t.olderLoading : t.older}
              </button>
            )}
          </li>
        ) : null}
        {messages.length === 0 ? <li className="chat-empty">{t.empty}</li> : null}
        {messages.map((m, i) => {
          const prev = i > 0 ? messages[i - 1]! : null;
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
          const cont = prev !== null && !newDay && prev.author.username === m.author.username && Date.parse(m.at) - Date.parse(prev.at) < GROUP_MS;
          return (
            <Fragment key={m.id}>
              {newDay ? (
                <li className="chat-day" role="separator">
                  <span>{dayLabel(m.at)}</span>
                </li>
              ) : null}
              <ChatMessageItem
                m={m}
                me={me}
                own={m.author.username === me}
                cont={cont}
                mentionsMe={m.author.username !== me && mentionsIn(m.body).includes(me.toLowerCase())}
                showClan={history.channel === 'global'}
                moderator={history.moderator}
                canReport={history.reason !== 'level'}
                reported={reported.has(m.id)}
                busy={busy}
                onReport={() => onReport(m)}
                onHide={() => onHide(m)}
                onMute={() => onMute(m)}
                onBlock={() => onBlock(m)}
              />
            </Fragment>
          );
        })}
      </ol>
      {below > 0 ? (
        <button type="button" className="lip pill small chat-new-below" onClick={toBottom}>
          <Icon name="down" />
          <span>{t.newBelow(below)}</span>
        </button>
      ) : null}
    </div>
  );
}

/** Moderators: a reason, then the account cannot write for an hour. */
function MuteDialog({ username, onClose, onDone }: { username: string; onClose: () => void; onDone: (u: string) => void }) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const mute = useMuteAccount();
  return (
    <Dialog title={t.muteOf(username)} className="chat-confirm" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) mute.mutate({ username, reason: reason.trim() }, { onSuccess: () => onDone(username) });
        }}
      >
        <div className="field">
          <label htmlFor={reasonId}>{t.muteReason}</label>
          <div className="control">
            <input id={reasonId} data-autofocus value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        {mute.error ? (
          <p className="field-error" role="alert">
            {errorText(mute.error, copy.errors)}
          </p>
        ) : null}
        <div className="confirm-actions">
          <button type="button" className="lip pill" onClick={onClose}>
            {t.cancel}
          </button>
          <button type="submit" className="lip pill danger" disabled={!reason.trim() || mute.isPending}>
            {t.muteConfirm}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
