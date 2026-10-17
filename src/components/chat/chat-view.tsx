"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, X } from "lucide-react";
import { Composer } from "@/components/chat/composer";
import { MessageItem } from "@/components/chat/message-item";
import { MessageList } from "@/components/chat/message-list";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  deleteMessageAction,
  editMessageAction,
  markReadAction,
  setPinnedAction,
  toggleReactionAction,
} from "@/lib/chat/actions";
import {
  applyReactionToggle,
  applyToWindow,
  cmpTime,
  mergeDirectory,
  removeById,
  upsertSorted,
  type ChatMessage,
  type Directory,
  type ReactionChip,
  type ViewerPermissions,
} from "@/lib/chat/model";
import { getMessage, getMessages, getPinned, getThread } from "@/lib/chat/queries";
import { useChannelEvents, type ChannelEvent } from "@/lib/chat/realtime";
import { useUnread } from "@/lib/chat/unread";
import { rpcErrorMessage } from "@/lib/errors";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/use-media-query";

export interface ChatViewProps {
  channel: { id: string; slowmodeSeconds: number };
  viewer: ViewerPermissions;
  allowedDomains: readonly string[];
  initial: {
    messages: ChatMessage[];
    hasMore: boolean;
    directory: Directory;
    pinned: ChatMessage[];
    /** `channel_reads.last_read_at` before this visit: where the "Nuevos" separator goes. */
    lastReadAt: string | null;
  };
}

interface ThreadState {
  rootId: string;
  root: ChatMessage | null;
  replies: ChatMessage[];
  loading: boolean;
}

const NOTICE_MS = 7000;

const byPinnedDesc = (a: ChatMessage, b: ChatMessage) => cmpTime(b.pinnedAt ?? "", a.pinnedAt ?? "");

function upsertPinned(list: readonly ChatMessage[], m: ChatMessage): ChatMessage[] {
  const without = list.filter((x) => x.id !== m.id);
  return m.pinnedAt && !m.deletedAt && m.threadRootId === null ? [...without, m].sort(byPinnedDesc) : without;
}

/** The chat of one text channel: timeline, pins, threads, realtime reconciliation and read marks. */
export function ChatView({ channel, viewer, allowedDomains, initial }: ChatViewProps) {
  const channelId = channel.id;
  const meId = viewer.memberId;
  const { refresh: refreshUnread } = useUnread();

  const [roots, setRoots] = useState(initial.messages);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const [directory, setDirectory] = useState(initial.directory);
  const [pinned, setPinned] = useState(initial.pinned);
  const [thread, setThread] = useState<ThreadState | null>(null);
  const [quoted, setQuoted] = useState<{ id: string; authorName: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [scrollKey, setScrollKey] = useState(0);

  const rootsRef = useRef(roots);
  const hasMoreRef = useRef(hasMore);
  const threadRef = useRef(thread);
  const directoryRef = useRef(directory);
  useEffect(() => {
    rootsRef.current = roots;
    hasMoreRef.current = hasMore;
    threadRef.current = thread;
    directoryRef.current = directory;
  });
  const requests = useRef(new Map<string, number>());
  const openerRef = useRef<HTMLElement | null>(null);
  const composerBox = useRef<HTMLDivElement>(null);

  const wide = useMediaQuery("(min-width: 1024px)");
  const split = useMediaQuery("(min-width: 1280px)");

  const mergeDir = useCallback((extra: Directory) => setDirectory((d) => mergeDirectory(d, extra)), []);

  // --- read marks ---------------------------------------------------------------------------------

  const atBottom = useRef(true);
  const unreadDirty = useRef(false);
  const readInFlight = useRef(false);
  const readQueued = useRef(false);

  const markRead = useCallback(function run() {
    if (document.visibilityState === "hidden") {
      unreadDirty.current = true;
      return;
    }
    if (readInFlight.current) {
      readQueued.current = true;
      return;
    }
    readInFlight.current = true;
    unreadDirty.current = false;
    void markReadAction(channelId)
      .catch(() => ({ error: "unknown" }))
      .then(() => {
        readInFlight.current = false;
        refreshUnread();
        if (readQueued.current) {
          readQueued.current = false;
          run();
        }
      });
  }, [channelId, refreshUnread]);

  useEffect(() => {
    markRead();
    const onVisible = () => {
      if (document.visibilityState === "visible" && atBottom.current && unreadDirty.current) markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  const onAtBottomChange = useCallback(
    (value: boolean) => {
      atBottom.current = value;
      if (value && unreadDirty.current) markRead();
    },
    [markRead],
  );

  // --- reconciliation -----------------------------------------------------------------------------

  const patchMessage = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    const apply = (m: ChatMessage) => (m.id === id ? fn(m) : m);
    setRoots((l) => l.map(apply));
    setPinned((l) => l.map(apply));
    setThread((t) => (t ? { ...t, root: t.root ? apply(t.root) : null, replies: t.replies.map(apply) } : t));
  }, []);

  const remove = useCallback((id: string) => {
    setRoots((l) => removeById(l, id));
    setPinned((l) => removeById(l, id));
    setThread((t) => {
      if (!t) return t;
      if (t.rootId === id) return null;
      return { ...t, replies: removeById(t.replies, id) };
    });
  }, []);

  const apply = useCallback(
    (m: ChatMessage) => {
      if (m.threadRootId === null) {
        const isNew = !rootsRef.current.some((x) => x.id === m.id);
        if (isNew && m.authorId !== meId && !m.deletedAt) {
          setAnnouncement(`Mensaje nuevo de ${directoryRef.current.members[m.authorId]?.name ?? "un miembro"}`);
        }
        setRoots((l) => applyToWindow(l, m, hasMoreRef.current));
        setPinned((l) => upsertPinned(l, m));
        setThread((t) => (t && t.rootId === m.id ? { ...t, root: m } : t));
      } else {
        setThread((t) => (t && t.rootId === m.threadRootId ? { ...t, replies: upsertSorted(t.replies, m) } : t));
      }
    },
    [meId],
  );

  /** Re-reads one message through RLS and folds it into whatever is on screen. Stale answers are dropped. */
  const reconcile = useCallback(
    async (id: string) => {
      const ticket = (requests.current.get(id) ?? 0) + 1;
      requests.current.set(id, ticket);
      let result;
      try {
        result = await getMessage(createBrowserClient(), id, meId);
      } catch {
        return;
      }
      if (requests.current.get(id) !== ticket) return;
      if (!result.message) {
        remove(id);
        return;
      }
      mergeDir(result.directory);
      apply(result.message);
    },
    [apply, meId, mergeDir, remove],
  );

  const resync = useCallback(async () => {
    const supabase = createBrowserClient();
    try {
      const [page, pins] = await Promise.all([getMessages(supabase, channelId, meId), getPinned(supabase, channelId, meId)]);
      mergeDir(page.directory);
      mergeDir(pins.directory);
      setRoots((l) => page.messages.reduce((acc, m) => applyToWindow(acc, m, hasMoreRef.current), l));
      setPinned(pins.messages);
      const open = threadRef.current;
      if (open) {
        const t = await getThread(supabase, open.rootId, meId);
        mergeDir(t.directory);
        setThread((cur) => (cur && cur.rootId === open.rootId ? { ...cur, root: t.root, replies: t.replies, loading: false } : cur));
      }
    } catch {
      // the next event or resync catches up
    }
    refreshUnread();
  }, [channelId, meId, mergeDir, refreshUnread]);

  useChannelEvents(
    channelId,
    (event: ChannelEvent) => {
      void reconcile(event.id);
      if (event.threadRootId) void reconcile(event.threadRootId);
      refreshUnread();
      if (atBottom.current) markRead();
      else unreadDirty.current = true;
    },
    { onResync: () => void resync() },
  );

  // --- history ------------------------------------------------------------------------------------

  const loadMore = useCallback(async () => {
    const oldest = rootsRef.current[0];
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getMessages(createBrowserClient(), channelId, meId, {
        before: { createdAt: oldest.createdAt, id: oldest.id },
      });
      mergeDir(page.directory);
      setRoots((l) => page.messages.reduce((acc, m) => (acc.some((x) => x.id === m.id) ? acc : upsertSorted(acc, m)), l));
      setHasMore(page.hasMore);
    } catch {
      setNotice(rpcErrorMessage("unknown"));
    } finally {
      setLoadingMore(false);
    }
  }, [channelId, loadingMore, meId, mergeDir]);

  // --- threads ------------------------------------------------------------------------------------

  const openThread = useCallback(
    (message: ChatMessage, opener: HTMLElement | null) => {
      openerRef.current = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      setThread({ rootId: message.id, root: message, replies: [], loading: true });
      void (async () => {
        try {
          const res = await getThread(createBrowserClient(), message.id, meId);
          mergeDir(res.directory);
          setThread((t) => (t && t.rootId === message.id ? { rootId: message.id, root: res.root, replies: res.replies, loading: false } : t));
        } catch {
          setThread((t) => (t && t.rootId === message.id ? { ...t, loading: false } : t));
        }
      })();
    },
    [meId, mergeDir],
  );

  const closeThread = useCallback(() => {
    if (!threadRef.current) return;
    setThread(null);
    const opener = openerRef.current;
    openerRef.current = null;
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
    });
  }, []);

  // --- message actions ----------------------------------------------------------------------------

  const toggleReaction = useCallback(
    async (message: ChatMessage, emoji: string) => {
      const before: ReactionChip[] = message.reactions;
      patchMessage(message.id, (m) => ({ ...m, reactions: applyReactionToggle(m.reactions, emoji) }));
      const res = await toggleReactionAction({ messageId: message.id, emoji }).catch(() => ({ error: "unknown" }) as { error?: string });
      if (res.error) {
        patchMessage(message.id, (m) => ({ ...m, reactions: before }));
        setNotice(rpcErrorMessage(res.error));
      }
    },
    [patchMessage],
  );

  const editMessage = useCallback(
    async (message: ChatMessage, doc: unknown): Promise<string | null> => {
      const res = await editMessageAction({ id: message.id, doc });
      if (res.error) return rpcErrorMessage(res.error);
      void reconcile(message.id);
      return null;
    },
    [reconcile],
  );

  const deleteMessage = useCallback(
    async (message: ChatMessage): Promise<string | null> => {
      const res = await deleteMessageAction(message.id);
      if (res.error) return rpcErrorMessage(res.error);
      void reconcile(message.id);
      return null;
    },
    [reconcile],
  );

  const pinMessage = useCallback(
    async (message: ChatMessage, value: boolean) => {
      const res = await setPinnedAction({ messageId: message.id, pinned: value });
      if (res.error) setNotice(rpcErrorMessage(res.error));
      else void reconcile(message.id);
    },
    [reconcile],
  );

  const quoteMessage = useCallback((message: ChatMessage) => {
    setQuoted({ id: message.id, authorName: directoryRef.current.members[message.authorId]?.name ?? "Miembro" });
    requestAnimationFrame(() => composerBox.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus());
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const itemHandlers = {
    onOpenThread: openThread,
    onQuote: quoteMessage,
    onEdit: editMessage,
    onDelete: deleteMessage,
    onPin: (m: ChatMessage, value: boolean) => void pinMessage(m, value),
    onToggleReaction: (m: ChatMessage, emoji: string) => void toggleReaction(m, emoji),
  };

  const threadPanel = (inDialog: boolean) =>
    thread ? (
      <ThreadPanel
        root={thread.root}
        replies={thread.replies}
        loading={thread.loading}
        directory={directory}
        allowedDomains={allowedDomains}
        viewer={viewer}
        channelId={channelId}
        slowmodeSeconds={channel.slowmodeSeconds}
        onClose={closeThread}
        onPosted={(id) => {
          void reconcile(id);
          void reconcile(thread.rootId);
          markRead();
        }}
        inDialog={inDialog}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onToggleReaction={itemHandlers.onToggleReaction}
      />
    ) : null;

  return (
    <section aria-label="Chat del canal" className="relative flex h-[calc(100dvh-13rem)] min-h-[28rem] overflow-hidden rounded-panel border border-border bg-bg">
      <div className="flex min-w-0 flex-1 flex-col" inert={wide && !split && thread !== null}>
        {pinned.length > 0 ? (
          <div className="flex justify-end border-b border-border px-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setPinnedOpen(true)}>
              <Pin aria-hidden />
              {`Fijados (${pinned.length})`}
            </Button>
          </div>
        ) : null}

        <MessageList
          messages={roots}
          directory={directory}
          allowedDomains={allowedDomains}
          viewer={viewer}
          lastReadAt={initial.lastReadAt}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          onAtBottomChange={onAtBottomChange}
          scrollToBottomKey={scrollKey}
          {...itemHandlers}
        />

        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>

        {notice ? (
          <div role="alert" className="flex items-center justify-between gap-2 border-t border-danger bg-surface px-4 py-2 text-sm text-danger">
            <span>{notice}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
              <X aria-hidden />
            </Button>
          </div>
        ) : null}

        <div ref={composerBox}>
          {viewer.canPost ? (
            <Composer
              channelId={channelId}
              canPost
              canAttach={viewer.canAttach}
              canMentionEveryone={viewer.canMentionEveryone}
              slowmodeSeconds={channel.slowmodeSeconds}
              quoted={quoted ?? undefined}
              onRemoveQuoted={() => setQuoted(null)}
              onPosted={(id) => {
                void reconcile(id);
                setScrollKey((k) => k + 1);
                markRead();
              }}
            />
          ) : (
            <p className="border-t border-border bg-surface px-4 py-3 text-sm text-fg-muted">Este canal es de solo lectura.</p>
          )}
        </div>
      </div>

      {thread && wide ? (
        <aside
          aria-label="Panel del hilo"
          className="absolute inset-y-0 right-0 z-10 w-[min(24rem,100%)] border-l border-border-strong xl:static xl:z-auto xl:w-96 xl:shrink-0"
        >
          {threadPanel(false)}
        </aside>
      ) : null}

      <Dialog open={thread !== null && !wide} onOpenChange={(open) => !open && closeThread()}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 p-0 sm:max-w-none"
        >
          {!wide ? threadPanel(true) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={pinnedOpen} onOpenChange={setPinnedOpen}>
        <DialogContent aria-describedby={undefined} className="max-h-[80dvh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>{`Fijados (${pinned.length})`}</DialogTitle>
          {pinned.length === 0 ? (
            <p className="text-fg-muted">No queda ningún mensaje fijado.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {pinned.map((m) => (
                <MessageItem key={m.id} message={m} directory={directory} allowedDomains={allowedDomains} viewer={viewer} variant="pinned" />
              ))}
            </ol>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
