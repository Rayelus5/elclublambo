import type { ChatChannel, ChatHistory, ChatMentionCandidate, FriendsView, RoomView } from '@galaxy/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { searchMentionNames, useSendMessage } from '../api/chat';
import { ApiError } from '../api/client';
import { FRIENDS_KEY } from '../api/friends';
import { ROOMS_KEY } from '../api/rooms';
import { errorText } from '../auth/useMe';
import { copy } from '../copy/es';
import { Avatar } from '../hub/Avatar';
import { clock } from './ChatMessageItem';

const t = copy.chat;

/** The «@nombre» being written just before the caret, and where it starts (null: none). */
export function mentionAt(text: string, caret: number): { q: string; start: number } | null {
  const m = /(?:^|[\s(¡¿])@([a-z0-9_]{0,20})$/i.exec(text.slice(0, caret));
  if (!m) return null;
  return { q: m[1]!.toLowerCase(), start: caret - m[1]!.length - 1 };
}

/** The names to offer for a beginning: who wrote here, my friends and my room first, then the server's (2+ letters). */
function useCandidates(channel: ChatChannel, history: ChatHistory, q: string | null, me: string): ChatMentionCandidate[] {
  const qc = useQueryClient();
  const [remote, setRemote] = useState<{ q: string; players: ChatMentionCandidate[] } | null>(null);
  useEffect(() => {
    if (q === null || q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      searchMentionNames(q)
        .then((players) => live && setRemote({ q, players }))
        .catch(() => live && setRemote({ q, players: [] }));
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);
  if (q === null) return [];
  const local: ChatMentionCandidate[] = [
    ...[...history.messages].reverse().map((m) => ({ username: m.author.username, avatar: m.author.avatar, frame: m.author.frame })),
    ...(channel === 'room' ? (qc.getQueryData<{ mine: RoomView | null }>(ROOMS_KEY)?.mine?.members ?? []) : []),
    ...(qc.getQueryData<FriendsView>(FRIENDS_KEY)?.friends ?? []),
    ...(remote && q.startsWith(remote.q) ? remote.players : []),
  ];
  const seen = new Set<string>([me]);
  const out: ChatMentionCandidate[] = [];
  for (const c of local) {
    if (seen.has(c.username) || !c.username.startsWith(q)) continue;
    seen.add(c.username);
    out.push({ username: c.username, avatar: c.avatar ?? null, frame: c.frame ?? null });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Writing (GDD §14.4; the owner's chat asks, 2026-11-14): a counter against the channel's maximum, Enter sends and
 * Shift+Enter breaks the line; when one cannot write, why. «@» and the beginning of a name opens a list of players to
 * name (WAI-ARIA combobox: the arrows move in it, Enter or Tab picks, Escape closes it); the name goes in whole.
 */
export function Composer({ channel, history, me }: { channel: ChatChannel; history: ChatHistory; me: string }) {
  const fieldId = useId();
  const noteId = useId();
  const countId = useId();
  const listId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [closedAt, setClosedAt] = useState<number | null>(null);
  const send = useSendMessage(channel);
  const count = [...text].length;
  const over = count > history.maxLength;
  const blocked = !history.canWrite;
  const why =
    history.reason === 'level' ? t.needLevel(history.minLevel) : history.reason === 'muted' && history.mutedUntil ? t.mutedUntil(clock(history.mutedUntil)) : null;
  const failure = send.error instanceof ApiError && send.error.code === 'rate_limited' ? t.tooFast : errorText(send.error, copy.errors);
  const at = mentionAt(text, caret);
  const open = at !== null && closedAt !== at.start;
  const options = useCandidates(channel, history, open ? at.q : null, me);
  const shown = open && options.length > 0;
  const pick = Math.min(active, Math.max(0, options.length - 1));

  function submit(): void {
    if (blocked || over || !text.trim() || send.isPending) return;
    send.mutate(text, {
      onSuccess: () => {
        setText('');
        setCaret(0);
      },
    });
  }

  function choose(c: ChatMentionCandidate): void {
    if (!at) return;
    const next = `${text.slice(0, at.start)}@${c.username} ${text.slice(caret)}`;
    const place = at.start + c.username.length + 2;
    setText(next);
    setCaret(place);
    setActive(0);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(place, place);
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (shown) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((pick + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        choose(options[pick]!);
        return;
      }
      if (e.key === 'Escape') {
        // The list closes; the sheet stays.
        e.preventDefault();
        e.stopPropagation();
        setClosedAt(at!.start);
        return;
      }
    }
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
        {shown ? (
          <ul id={listId} role="listbox" aria-label={t.mentionList} className="chat-mentions">
            {options.map((c, i) => (
              <li
                key={c.username}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === pick}
                className="chat-mention-option"
                onPointerDown={(e) => {
                  // Picking keeps the focus in the field.
                  e.preventDefault();
                  choose(c);
                }}
              >
                <Avatar name={c.username} avatar={c.avatar} frame={c.frame} />
                <span>{c.username}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={field}
          id={fieldId}
          rows={2}
          value={text}
          disabled={blocked}
          placeholder={blocked ? undefined : channel === 'global' ? t.placeholder : channel === 'room' ? t.placeholderRoom : t.placeholderClan}
          aria-invalid={over || undefined}
          aria-describedby={`${noteId} ${countId}`}
          aria-autocomplete="list"
          aria-controls={shown ? listId : undefined}
          aria-expanded={shown}
          aria-activedescendant={shown ? `${listId}-${pick}` : undefined}
          role="combobox"
          onChange={(e) => {
            setText(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
            setActive(0);
            setClosedAt(null);
            if (send.error) send.reset();
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onBlur={() => at && setClosedAt(at.start)}
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
