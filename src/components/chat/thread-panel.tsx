"use client";

import { useEffect, useRef } from "react";
import { Loader2, X } from "lucide-react";
import { Composer } from "@/components/chat/composer";
import { MessageItem, type MessageItemHandlers } from "@/components/chat/message-item";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { scrollMessageIntoView } from "@/lib/chat/scroll";
import { isGrouped, type ChatMessage, type Directory, type ViewerPermissions } from "@/lib/chat/model";

export interface ThreadPanelProps extends Pick<MessageItemHandlers, "onEdit" | "onDelete" | "onToggleReaction"> {
  /** null while loading, or when the thread no longer exists / is not visible. */
  root: ChatMessage | null;
  replies: readonly ChatMessage[];
  loading: boolean;
  directory: Directory;
  allowedDomains: readonly string[];
  viewer: ViewerPermissions;
  channelId: string;
  slowmodeSeconds: number;
  onClose: () => void;
  onPosted?: (id: string) => void;
  /** Rendered inside a Radix Dialog: the heading is then the dialog's title. */
  inDialog?: boolean;
  /** Reply of a `?m=` jump: centred once the thread has loaded, and highlighted while set. */
  highlightId?: string | null;
}

/** One-level thread: the root, its replies and a composer bound to the thread. Used inline (≥1024) and in a dialog. */
export function ThreadPanel({
  root,
  replies,
  loading,
  directory,
  allowedDomains,
  viewer,
  channelId,
  slowmodeSeconds,
  onClose,
  onPosted,
  inDialog = false,
  highlightId = null,
  ...handlers
}: ThreadPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Focus moves into the panel when it opens; the opener gets it back when it closes (ChatView). One frame later:
  // the dropdown menu that opened the thread still traps focus during the commit and would pull it back.
  useEffect(() => {
    const frame = requestAnimationFrame(() => heading.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const count = replies.length;
  // The jump target is centred the first time it is rendered. After that only a change of the reply count follows
  // the end (clearing the highlight must not yank the reader away).
  const centred = useRef<string | null>(null);
  const lastCount = useRef<number | null>(null);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (highlightId && centred.current !== highlightId) {
      const target = el.querySelector(`[data-message-id="${highlightId}"]`);
      if (target) {
        centred.current = highlightId;
        lastCount.current = count;
        scrollMessageIntoView(target);
        return;
      }
      if (loading) return;
    }
    if (lastCount.current === count) return;
    lastCount.current = count;
    if (!highlightId || centred.current !== highlightId) el.scrollTop = el.scrollHeight;
  }, [count, highlightId, loading]);

  return (
    <section
      aria-labelledby={inDialog ? undefined : "thread-title"}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border pl-4">
        {inDialog ? (
          <DialogTitle ref={heading} tabIndex={-1} className="font-display text-lg font-bold outline-none">
            Hilo
          </DialogTitle>
        ) : (
          <h2 id="thread-title" ref={heading} tabIndex={-1} className="font-display text-lg font-bold outline-none">
            Hilo
          </h2>
        )}
        <Button type="button" variant="ghost" size="icon" aria-label="Cerrar hilo" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {loading && !root ? (
          <p role="status" className="flex items-center gap-2 text-fg-muted">
            <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            Cargando hilo…
          </p>
        ) : !root ? (
          <p className="text-fg-muted">Este hilo ya no existe o no puedes verlo.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <ol>
              <MessageItem
                message={root}
                directory={directory}
                allowedDomains={allowedDomains}
                viewer={viewer}
                variant="thread"
                {...handlers}
              />
            </ol>
            <p className="border-t border-border pt-3 text-[13px] font-bold text-fg-muted">
              {count === 0 ? "Sin respuestas todavía" : count === 1 ? "1 respuesta" : `${count} respuestas`}
            </p>
            {count > 0 ? (
              <ol aria-label="Respuestas">
                {replies.map((m, i) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    directory={directory}
                    allowedDomains={allowedDomains}
                    viewer={viewer}
                    variant="thread"
                    highlighted={m.id === highlightId}
                    grouped={isGrouped(replies[i - 1], m)}
                    {...handlers}
                  />
                ))}
              </ol>
            ) : null}
          </div>
        )}
      </div>

      {root ? (
        viewer.canThread ? (
          <Composer
            channelId={channelId}
            threadRootId={root.id}
            canPost
            canAttach={viewer.canAttach}
            canMentionEveryone={viewer.canMentionEveryone}
            slowmodeSeconds={slowmodeSeconds}
            onPosted={onPosted}
          />
        ) : (
          <p className="border-t border-border px-4 py-3 text-sm text-fg-muted">No puedes responder en hilos de este canal.</p>
        )
      ) : null}
    </section>
  );
}
