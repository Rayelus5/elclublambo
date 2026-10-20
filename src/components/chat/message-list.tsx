"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Loader2 } from "lucide-react";
import { MessageItem, type MessageDelivery, type MessageItemHandlers } from "@/components/chat/message-item";
import { Button } from "@/components/ui/button";
import { countUnseen, decideScroll, isNearBottom, newMessagesLabel, scrollMessageIntoView, type Cursor } from "@/lib/chat/scroll";
import { buildTimeline, isArrival } from "@/lib/chat/timeline";
import { useViewerDay } from "@/lib/chat/use-viewer-day";
import type { ChatMessage, Directory, ViewerPermissions } from "@/lib/chat/model";

/** A message I sent that the server has not confirmed yet (or refused): shown after the timeline. */
export interface PendingView extends MessageDelivery {
  message: ChatMessage;
}

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
  /** State of "Ir a lo más reciente": `error` after a navigation that never completed. */
  latest?: "idle" | "loading" | "error";
  /** Initial scroll target when it differs from the highlight (the root of a reply anchor). */
  scrollToId?: string | null;
  /** My optimistic messages, newest last. */
  pending?: readonly PendingView[];
  /** Real message id -> the pending key it replaced: the row keeps its React key (no remount, no second animation). */
  rowKeys?: Readonly<Record<string, string>>;
}

const NO_PENDING: readonly PendingView[] = [];
const NO_KEYS: Readonly<Record<string, string>> = {};

/**
 * The timeline: anchored to the bottom, follows new messages while the reader is at the bottom (a pill counts them
 * otherwise), keeps the reading position when older messages are prepended, separates days in the viewer's time zone,
 * groups runs of the same author, marks where the unread start and animates only what arrives after mount.
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
  latest = "idle",
  scrollToId = null,
  pending = NO_PENDING,
  rowKeys = NO_KEYS,
  ...handlers
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prev = useRef<{ firstId: string | undefined; height: number; key: number; day: string | null }>({
    firstId: undefined,
    height: 0,
    key: scrollToBottomKey,
    day: null,
  });
  // Where the reader left the bottom: what arrives after it is counted in the «N mensajes nuevos» pill.
  const [unseenMark, setUnseenMark] = useState<Cursor | null>(null);
  // The initial placement happens once: the anchor if there is one in the window, the bottom otherwise.
  const initialAnchor = useRef(scrollToId ?? highlightId);
  // The history on screen at mount never animates; only messages newer than its newest one do.
  const [newestAtMount] = useState(() => messages.at(-1));
  const newestRef = useRef(messages.at(-1));
  useLayoutEffect(() => {
    newestRef.current = messages.at(-1);
  });

  const report = useCallback(
    (value: boolean) => {
      if (atBottom.current === value) return;
      atBottom.current = value;
      const last = newestRef.current;
      setUnseenMark(value || !last ? null : { createdAt: last.createdAt, id: last.id });
      onAtBottomChange?.(value);
    },
    [onAtBottomChange],
  );

  const scrollToBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const day = useViewerDay();
  const timeZone = day?.timeZone ?? null;
  const today = day?.today ?? null;
  const dayStamp = day ? `${timeZone}|${today}` : null;
  const all = useMemo(() => (pending.length > 0 ? [...messages, ...pending.map((p) => p.message)] : messages), [messages, pending]);
  const timeline = useMemo(
    () => buildTimeline(all, { lastReadAt, meId: viewer.memberId, timeZone, today }),
    [all, lastReadAt, viewer.memberId, timeZone, today],
  );
  const delivery = useMemo(() => new Map(pending.map((p) => [p.message.id, p])), [pending]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firstId = all[0]?.id;
    const before = prev.current;
    const initial = before.firstId === undefined;
    const prepended = !initial && firstId !== before.firstId && all.some((m) => m.id === before.firstId);
    const anchor = initial && initialAnchor.current ? el.querySelector(`[data-message-id="${initialAnchor.current}"]`) : null;
    const action = decideScroll({ initial, anchorFound: anchor !== null, forced: before.key !== scrollToBottomKey, prepended, atBottom: atBottom.current });

    if (action === "anchor" && anchor) {
      // Not at the bottom any more: report it so mark-read waits until the reader really reaches the end.
      report(false);
      scrollMessageIntoView(anchor);
    } else if (action === "bottom") {
      scrollToBottom();
      report(true);
    } else if (action === "keep") {
      // Keep what the reader was looking at in place.
      el.scrollTop += el.scrollHeight - before.height;
    } else if (before.day === null && dayStamp !== null && initialAnchor.current) {
      // The day separators appeared right after hydration and pushed the `?m=` anchor down: centre it again.
      const target = el.querySelector(`[data-message-id="${initialAnchor.current}"]`);
      if (target) scrollMessageIntoView(target, true);
    }
    prev.current = { firstId, height: el.scrollHeight, key: scrollToBottomKey, day: dayStamp };
  }, [all, dayStamp, scrollToBottomKey, scrollToBottom, report]);

  const unseen = countUnseen(messages, unseenMark, viewer.memberId);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        role="log"
        aria-label="Mensajes del canal"
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => report(isNearBottom(e.currentTarget))}
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

          {all.length === 0 ? (
            <p className="py-10 text-center text-fg-muted">
              {viewer.canPost ? "Todavía no hay mensajes. Sé el primero en escribir." : "Todavía no hay mensajes."}
            </p>
          ) : (
            <ol className="flex flex-col">
              {timeline.map((entry) =>
                entry.type === "day" ? (
                  <DaySeparator key={`day-${entry.key}`} label={entry.label} />
                ) : entry.type === "unread" ? (
                  <UnreadSeparator key="unread" />
                ) : (
                  <MessageItem
                    key={rowKeys[entry.message.id] ?? entry.message.id}
                    message={entry.message}
                    directory={directory}
                    allowedDomains={allowedDomains}
                    viewer={viewer}
                    grouped={entry.grouped}
                    highlighted={entry.message.id === highlightId}
                    entering={isArrival(entry.message, newestAtMount)}
                    delivery={delivery.get(entry.message.id)}
                    {...handlers}
                  />
                ),
              )}
            </ol>
          )}
        </div>
      </div>

      {hasNewer ? (
        <div className="absolute right-4 bottom-3 left-4 flex flex-col items-end gap-2">
          {latest === "error" ? (
            <p role="alert" className="rounded-control border border-danger bg-surface px-3 py-2 text-sm text-danger">
              No se pudo cargar lo más reciente. Inténtalo de nuevo.
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            disabled={latest === "loading"}
            aria-busy={latest === "loading"}
            onClick={onGoLatest}
            className="max-w-full"
          >
            {latest === "loading" ? <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" /> : <ArrowDown aria-hidden />}
            {latest === "error" ? <span>Reintentar</span> : null}
            {latest !== "error" && pendingNew ? (
              <>
                {/* Below sm the long copy would not fit 375 px: a short visible label, the full one for readers. */}
                <span aria-hidden className="sm:hidden">
                  Nuevos
                </span>
                <span className="sr-only sm:not-sr-only">Hay mensajes nuevos</span>
                <span className="sr-only">. </span>
              </>
            ) : null}
            {latest !== "error" ? (
              <span className={pendingNew ? "border-l border-current/40 pl-2" : undefined}>Ir a lo más reciente</span>
            ) : null}
          </Button>
        </div>
      ) : unseen > 0 ? (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            scrollToBottom();
            report(true);
          }}
          className="absolute right-4 bottom-3 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          {newMessagesLabel(unseen)}
          <ArrowDown aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

function DaySeparator({ label }: { label: string }) {
  return (
    <li role="separator" aria-label={label} className="my-3 flex items-center gap-3 text-[12px] font-semibold text-fg-muted">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span aria-hidden className="rounded-control border border-border px-2.5 py-0.5">
        {label}
      </span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </li>
  );
}

function UnreadSeparator() {
  return (
    <li role="separator" aria-label="Nuevos mensajes" className="my-3 flex items-center gap-3 text-[13px] font-bold text-accent">
      <span aria-hidden className="h-px flex-1 bg-accent" />
      Nuevos
      <span aria-hidden className="h-px flex-1 bg-accent" />
    </li>
  );
}
