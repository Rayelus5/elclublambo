"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { MessageItem, type MessageItemHandlers } from "@/components/chat/message-item";
import { Button } from "@/components/ui/button";
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

    if (before.firstId === undefined || forced) {
      scrollToBottom();
    } else if (prepended) {
      // Keep what the reader was looking at in place.
      el.scrollTop += el.scrollHeight - before.height;
    } else if (appended) {
      if (atBottom.current) scrollToBottom();
      else setHasNew(true);
    }
    prev.current = { firstId, lastId, height: el.scrollHeight, key: scrollToBottomKey };
  }, [messages, scrollToBottomKey, scrollToBottom]);

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

      {hasNew ? (
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
  message,
  grouped,
  directory,
  allowedDomains,
  viewer,
  handlers,
}: {
  separator: boolean;
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
        {...handlers}
      />
    </>
  );
}
