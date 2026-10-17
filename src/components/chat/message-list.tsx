"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { MessageItem, type MessageItemHandlers } from "@/components/chat/message-item";
import { Button } from "@/components/ui/button";
import { scrollMessageIntoView } from "@/lib/chat/scroll";
import { firstUnreadIndex, isGrouped, type ChatMessage, type Directory, type ViewerPermissions } from "@/lib/chat/model";

/** Within this many pixels of the end the list counts as "at the bottom" and keeps following new messages. */
const BOTTOM_SLACK = 48;

export interface MessageListProps extends MessageItemHandlers {
  messages: readonly ChatMessage[];
  directory: Directory;
  allowedDomains: readonly string[];
  viewer: ViewerPermissions;
  /** `channel_reads.last_read_at` at the time the channel was opened. */
  lastReadAt: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onAtBottomChange?: (atBottom: boolean) => void;
  /** Bump to force the list to the bottom (e.g. after sending a message). */
  scrollToBottomKey?: number;
  /** Message of a `?m=` jump: scrolled into view (centred) on mount and highlighted while set. */
  highlightId?: string | null;
  /** Newer messages exist beyond the loaded window (anchored view): the end of the list is not the latest. */
  hasNewer?: boolean;
  /** Sticky notice that live messages arrived but were not appended (needs `hasNewer`). */
  pendingNew?: boolean;
  onGoLatest?: () => void;
  goingLatest?: boolean;
}

/**
 * The timeline: anchored to the bottom, follows new messages while the reader is at the bottom, keeps the reading
 * position when older messages are prepended, groups runs of the same author and marks where the unread start.
 */
export function MessageList({
  messages,
  directory,
  allowedDomains,
  viewer,
  lastReadAt,
  hasMore,
  loadingMore,
  onLoadMore,
  onAtBottomChange,
  scrollToBottomKey = 0,
  highlightId = null,
  hasNewer = false,
  pendingNew = false,
  onGoLatest,
  goingLatest = false,
  ...handlers
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prev = useRef<{ firstId: string | undefined; lastId: string | undefined; height: number; key: number }>({
    firstId: undefined,
    lastId: undefined,
    height: 0,
    key: scrollToBottomKey,
  });
  const [hasNew, setHasNew] = useState(false);
  // The initial placement happens once: the anchor if there is one in the window, the bottom otherwise.
  const initialAnchor = useRef(highlightId);

  const report = useCallback(
    (value: boolean) => {
      if (atBottom.current === value) return;
      atBottom.current = value;
      if (value) setHasNew(false);
      onAtBottomChange?.(value);
    },
    [onAtBottomChange],
  );

  const scrollToBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const lastId = messages.at(-1)?.id;
    const before = prev.current;
    const prepended = before.firstId !== undefined && firstId !== before.firstId && messages.some((m) => m.id === before.firstId);
    const appended = before.lastId !== undefined && lastId !== before.lastId;
    const forced = before.key !== scrollToBottomKey;

    if (before.firstId === undefined && initialAnchor.current) {
      const target = el.querySelector(`[data-message-id="${initialAnchor.current}"]`);
      if (target) {
        // Not at the bottom any more: report it so mark-read waits until the reader really reaches the end.
        report(false);
        scrollMessageIntoView(target);
      } else scrollToBottom();
    } else if (before.firstId === undefined || forced) {
      scrollToBottom();
    } else if (prepended) {
      // Keep what the reader was looking at in place.
      el.scrollTop += el.scrollHeight - before.height;
    } else if (appended) {
      if (atBottom.current) scrollToBottom();
      else setHasNew(true);
    }
    prev.current = { firstId, lastId, height: el.scrollHeight, key: scrollToBottomKey };
  }, [messages, scrollToBottomKey, scrollToBottom, report]);

  const unreadAt = firstUnreadIndex(messages, lastReadAt, viewer.memberId);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        role="log"
        aria-label="Mensajes del canal"
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          report(el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_SLACK);
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 py-3 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <div className="mt-auto flex flex-col">
          {hasMore ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loadingMore}
              aria-busy={loadingMore}
              onClick={onLoadMore}
              className="mb-3 self-center"
            >
              {loadingMore ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : null}
              {loadingMore ? "Cargando…" : "Cargar anteriores"}
            </Button>
          ) : null}

          {messages.length === 0 ? (
            <p className="py-10 text-center text-fg-muted">
              {viewer.canPost ? "Todavía no hay mensajes. Sé el primero en escribir." : "Todavía no hay mensajes."}
            </p>
          ) : (
            <ol className="flex flex-col">
              {messages.map((m, i) => (
                <ListEntry
                  key={m.id}
                  separator={i === unreadAt}
                  message={m}
                  highlighted={m.id === highlightId}
                  grouped={i !== unreadAt && isGrouped(messages[i - 1], m)}
                  directory={directory}
                  allowedDomains={allowedDomains}
                  viewer={viewer}
                  handlers={handlers}
                />
              ))}
            </ol>
          )}
        </div>
      </div>

      {hasNewer ? (
        <Button
          type="button"
          size="sm"
          disabled={goingLatest}
          aria-busy={goingLatest}
          onClick={onGoLatest}
          className="absolute right-4 bottom-3"
        >
          {goingLatest ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ArrowDown aria-hidden />}
          {pendingNew ? "Hay mensajes nuevos" : null}
          {pendingNew ? <span className="sr-only">. </span> : null}
          <span className={pendingNew ? "border-l border-current/40 pl-2" : undefined}>Ir a lo más reciente</span>
        </Button>
      ) : hasNew ? (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            scrollToBottom();
            report(true);
          }}
          className="absolute right-4 bottom-3"
        >
          <ArrowDown aria-hidden />
          Mensajes nuevos
        </Button>
      ) : null}
    </div>
  );
}

function ListEntry({
  separator,
  highlighted,
  message,
  grouped,
  directory,
  allowedDomains,
  viewer,
  handlers,
}: {
  separator: boolean;
  highlighted: boolean;
  message: ChatMessage;
  grouped: boolean;
  directory: Directory;
  allowedDomains: readonly string[];
  viewer: ViewerPermissions;
  handlers: MessageItemHandlers;
}) {
  return (
    <>
      {separator ? (
        <li role="separator" aria-label="Nuevos mensajes" className="my-3 flex items-center gap-3 text-[13px] font-bold text-accent">
          <span aria-hidden className="h-px flex-1 bg-accent" />
          Nuevos
          <span aria-hidden className="h-px flex-1 bg-accent" />
        </li>
      ) : null}
      <MessageItem
        message={message}
        directory={directory}
        allowedDomains={allowedDomains}
        viewer={viewer}
        grouped={grouped}
        highlighted={highlighted}
        {...handlers}
      />
    </>
  );
}
