import type { ChatChannel, ChatHistory, ChatMessage, MeResponse } from '@galaxy/shared';
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { chatHistoryKey, useChatHistory, useHideMessage, useMuteAccount, useReportMessage, useSendMessage } from '../api/chat';
import { ApiError } from '../api/client';
import { useMyClan } from '../api/clans';
import { useRooms } from '../api/rooms';
import { errorText, useMe } from '../auth/useMe';
import { copy } from '../copy/es';
import { useUi } from '../state/ui';
import { Dialog } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { ChatMessageItem, clock } from './ChatMessageItem';
import { useChatSocket } from './useChatSocket';

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

type Pending = { kind: 'report' | 'mute'; m: ChatMessage } | null;

/**
 * The chat (GDD §14.4; DESIGN_SYSTEM §8 terdecies): a side sheet that does not block the game (a non-modal dialog).
 * Focus goes to the field (or to the tabs when one cannot write) and back to whatever opened it; Escape closes it.
 * Tabs for Comunidad and, with a clan, Clan; the socket keeps the open channel up to date.
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
  const down = useChatSocket();
  const report = useReportMessage();
  const hide = useHideMessage();
  const [reported, setReported] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
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

  return createPortal(
    <div
      ref={sheet}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="lip panel chat-sheet"
      onKeyDown={onKeyDown}
      onFocus={(e) => {
        lastFocus.current = e.target;
      }}
    >
      <header className="chat-top">
        <h2 id={titleId}>{t.title}</h2>
        <span className="chat-status" role="status">
          {down ? t.reconnecting : notice}
        </span>
        <button type="button" className="lip iconbtn small" aria-label={t.close} title={t.close} onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className="tabs chat-tabs" role="tablist" aria-label={t.channels}>
        {tabs.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            data-channel={c}
            aria-selected={c === active}
            aria-controls={panelId}
            tabIndex={c === active ? 0 : -1}
            onClick={() => openChat(c)}
            onKeyDown={onTabKey}
          >
            {t[c]}
          </button>
        ))}
      </div>
      <div id={panelId} role="tabpanel" aria-label={t[active]} className="chat-channel">
        {history.data ? (
          <>
            <MessageLog
              key={active}
              history={history.data}
              me={me.username}
              reported={reported}
              busy={hide.isPending}
              onReport={(m) => setPending({ kind: 'report', m })}
              onHide={(m) => hide.mutate({ id: m.id, channel: m.channel })}
              onMute={(m) => setPending({ kind: 'mute', m })}
            />
            {actionError && !(actionError instanceof ApiError && actionError.code === 'message_not_found') ? (
              <p className="field-error" role="alert">
                {errorText(actionError, copy.errors)}
              </p>
            ) : null}
            <Composer key={`compose-${active}`} channel={active} history={history.data} />
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
      ) : null}
    </div>,
    document.body,
  );
}

/** The channel's messages, oldest first; it stays at the bottom while one is reading the latest. */
function MessageLog({
  history,
  me,
  reported,
  busy,
  onReport,
  onHide,
  onMute,
}: {
  history: ChatHistory;
  me: string;
  reported: ReadonlySet<string>;
  busy: boolean;
  onReport: (m: ChatMessage) => void;
  onHide: (m: ChatMessage) => void;
  onMute: (m: ChatMessage) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = list.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [history.messages]);
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
  return (
    <ol
      ref={list}
      role="log"
      aria-label={t.messages}
      className="chat-log"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {history.messages.length === 0 ? <li className="chat-empty">{t.empty}</li> : null}
      {history.messages.map((m) => (
        <ChatMessageItem
          key={m.id}
          m={m}
          own={m.author.username === me}
          showClan={history.channel === 'global'}
          moderator={history.moderator}
          canReport={history.reason !== 'level'}
          reported={reported.has(m.id)}
          busy={busy}
          onReport={() => onReport(m)}
          onHide={() => onHide(m)}
          onMute={() => onMute(m)}
        />
      ))}
    </ol>
  );
}

/** Writing: a counter against the channel's maximum, Enter sends and Shift+Enter breaks the line; when one cannot write, why. */
function Composer({ channel, history }: { channel: ChatChannel; history: ChatHistory }) {
  const fieldId = useId();
  const noteId = useId();
  const countId = useId();
  const [text, setText] = useState('');
  const send = useSendMessage(channel);
  const count = [...text].length;
  const over = count > history.maxLength;
  const blocked = !history.canWrite;
  const why =
    history.reason === 'level' ? t.needLevel(history.minLevel) : history.reason === 'muted' && history.mutedUntil ? t.mutedUntil(clock(history.mutedUntil)) : null;
  const failure = send.error instanceof ApiError && send.error.code === 'rate_limited' ? t.tooFast : errorText(send.error, copy.errors);

  function submit(): void {
    if (blocked || over || !text.trim() || send.isPending) return;
    send.mutate(text, { onSuccess: () => setText('') });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  }

  return (
    <form
      className="chat-compose"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {failure ? (
        <p className="field-error" role="alert">
          {failure}
        </p>
      ) : null}
      <label htmlFor={fieldId} className="sr-only">
        {t.field}
      </label>
      <div className="chat-compose-row">
        <textarea
          id={fieldId}
          rows={2}
          value={text}
          disabled={blocked}
          placeholder={blocked ? undefined : channel === 'global' ? t.placeholder : channel === 'room' ? t.placeholderRoom : t.placeholderClan}
          aria-invalid={over || undefined}
          aria-describedby={`${noteId} ${countId}`}
          onChange={(e) => {
            setText(e.target.value);
            if (send.error) send.reset();
          }}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="lip pill pill-solar" disabled={blocked || over || !text.trim() || send.isPending}>
          {t.send}
        </button>
      </div>
      <p className="chat-compose-foot">
        <span id={noteId} className={why ? 'chat-why' : undefined}>
          {why ?? t.hint}
        </span>
        <span id={countId} className={over ? 'chat-count over' : 'chat-count'}>
          {t.count(count, history.maxLength)}
        </span>
      </p>
    </form>
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
