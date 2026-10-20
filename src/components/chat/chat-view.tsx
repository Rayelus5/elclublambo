"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pin, X } from "lucide-react";
import { CANCEL_EDIT_EVENT } from "@/components/chat/message-edit";
import { Composer } from "@/components/chat/composer";
import { MessageItem } from "@/components/chat/message-item";
import { MessageList } from "@/components/chat/message-list";
import { ThreadPanel } from "@/components/chat/thread-panel";
import { ThreadResizer } from "@/components/chat/thread-resizer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { markSolutionAction } from "@/lib/bounties/actions";
import {
  deleteMessageAction,
  editMessageAction,
  postMessageAction,
  setPinnedAction,
  toggleReactionAction,
} from "@/lib/chat/actions";
import { isEchoOf, pendingToMessage, settleOutcome, type OutgoingMessage, type PendingMessage } from "@/lib/chat/pending";
import type { PendingView } from "@/components/chat/message-list";
import { forgetPending, loadPending, savePending } from "@/lib/chat/pending-store";
import {
  applyReactionToggle,
  applyToWindow,
  cmpMessages,
  cmpTime,
  keepSignedUrls,
  mergeDirectory,
  removeById,
  replaceNewest,
  upsertSorted,
  type ChatMessage,
  type Directory,
  type ReactionChip,
  type ViewerPermissions,
} from "@/lib/chat/model";
import { getMessage, getMessages, getMessagesByIds, getPinned, getThread, markChannelRead } from "@/lib/chat/queries";
import { getTipSummaries } from "@/lib/payments/queries";
import { useChannelEvents, type ChannelEvent } from "@/lib/chat/realtime";
import { createThrottle } from "@/lib/chat/throttle";
import { useUnread } from "@/lib/chat/unread";
import { docToPlainText, toPlainDoc } from "@/lib/chat/content";
import { rpcErrorMessage } from "@/lib/errors";
import { createBrowserClient } from "@/lib/supabase/browser";
import { useMediaQuery } from "@/lib/use-media-query";
import { clampThreadWidth, loadThreadWidth, saveThreadWidth, THREAD_DEFAULT, THREAD_MIN } from "@/lib/chat/thread-width";

export interface ChatViewProps {
  channel: { id: string; slowmodeSeconds: number; alphaEnabled?: boolean };
  viewer: ViewerPermissions;
  allowedDomains: readonly string[];
  /** `?thread=<rootId>` from a notification link (already validated as a uuid by the page): opens that thread. */
  initialThreadId?: string | null;
  /**
   * `?m=<messageId>` (already validated and resolved by the server): the window in `initial` is built around it. It is
   * centred and highlighted for 2 s; when it is a reply, `initialThreadId` is its thread and it is highlighted there.
   */
  initialAnchorId?: string | null;
  /**
   * `&h=<nonce>` from the search palette (page-validated). Only the page uses it (it is part of the view key, so
   * choosing the same message again remounts and re-highlights); ChatView keeps it in the URLs it writes back.
   */
  initialAnchorNonce?: string | null;
  /** Replaces the composer when the member cannot post (the DAO post-gate notice); the plain read-only line otherwise. */
  postGate?: React.ReactNode;
  initial: {
    messages: ChatMessage[];
    hasMore: boolean;
    /** Anchored view: newer messages exist beyond the loaded window. */
    hasNewer?: boolean;
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

const QUOTE_CHARS = 140;
const FAIL_COPY = "No se ha podido enviar el mensaje";
/** After the server confirmed a send, re-read it once more this much later if it has not shown up (blip, no echo). */
export const CONFIRM_REREAD_MS = 4000;
const NOTICE_MS = 7000;
const THROTTLE_MS = 5000;
const HIGHLIGHT_MS = 2000;
const LATEST_TIMEOUT_MS = 8000;

const NO_PENDING: PendingView[] = [];

const byPinnedDesc = (a: ChatMessage, b: ChatMessage) => cmpTime(b.pinnedAt ?? "", a.pinnedAt ?? "");

function upsertPinned(list: readonly ChatMessage[], m: ChatMessage): ChatMessage[] {
  const without = list.filter((x) => x.id !== m.id);
  return m.pinnedAt && !m.deletedAt && m.threadRootId === null ? [...without, m].sort(byPinnedDesc) : without;
}

/** The chat of one text channel: timeline, pins, threads, realtime reconciliation and read marks. */
export function ChatView({ channel, viewer, allowedDomains, initial, initialThreadId = null, initialAnchorId = null, initialAnchorNonce = null, postGate }: ChatViewProps) {
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
  // Anchored view (`?m=`): the window may end before the newest message. Live messages beyond it are NOT appended (that
  // would leave a gap in the timeline, the same rule getMessages' cursor follows); they raise `pendingNew` instead and
  // "Ir a lo más reciente" reloads the normal view. Edits and deletes of loaded messages still apply.
  const [hasNewer] = useState(initial.hasNewer ?? false);
  const [pendingNew, setPendingNew] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(initialAnchorId);
  const [latest, setLatest] = useState<"idle" | "loading" | "error">("idle");
  const latestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (latestTimer.current) clearTimeout(latestTimer.current);
    },
    [],
  );
  // A reply anchor is not in the list: the list scrolls to its thread root instead.
  const anchorIsReply = initialAnchorId !== null && initialThreadId !== null && !initial.messages.some((m) => m.id === initialAnchorId);
  const listScrollId = anchorIsReply ? initialThreadId : initialAnchorId;

  // Optimistic sends (the channel composer): shown after the timeline until the real message replaces them.
  const [pending, setPending] = useState<PendingMessage[]>([]);
  // Real id -> pending key: the confirmed message keeps the pending row's React key (no remount, no second animation).
  const [rowKeys, setRowKeys] = useState<Record<string, string>>({});
  // Newest message brought by the last resync: what was missed while disconnected appears without the entry animation.
  const [quietUntil, setQuietUntil] = useState<ChatMessage | undefined>(undefined);

  const rootsRef = useRef(roots);
  const hasMoreRef = useRef(hasMore);
  const threadRef = useRef(thread);
  const directoryRef = useRef(directory);
  const hasNewerRef = useRef(hasNewer);
  // The source of truth for the pending rows, kept current synchronously: a send can settle before React re-renders.
  const pendingRef = useRef(pending);
  // Unconfirmed sends are also written to sessionStorage (per channel), so a remount does not lose a failed message.
  const updatePending = useCallback(
    (fn: (ps: PendingMessage[]) => PendingMessage[]) => {
      const next = fn(pendingRef.current);
      if (next === pendingRef.current) return;
      pendingRef.current = next;
      setPending(next);
      savePending(channelId, next);
    },
    [channelId],
  );
  // A send that settles after the view went away (channel switch, `?m=` remount) touches nothing here: no read mark on
  // a channel the member left, no state. Only the stored copy is updated.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Restore what was left unconfirmed in this channel, unless the history already has it (matched by its key).
  useEffect(() => {
    const landed = new Set(initial.messages.map((m) => m.clientId).filter(Boolean));
    const restored = loadPending(channelId).filter((p) => !landed.has(p.key));
    if (restored.length > 0) updatePending((ps) => [...restored, ...ps.filter((p) => !restored.some((r) => r.key === p.key))]);
    else savePending(channelId, pendingRef.current);
    // Mount only: `initial` is the server window this view was created with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    rootsRef.current = roots;
    hasMoreRef.current = hasMore;
    threadRef.current = thread;
    directoryRef.current = directory;
  });
  const requests = useRef(new Map<string, number>());
  const openerRef = useRef<HTMLElement | null>(null);
  const composerBox = useRef<HTMLDivElement>(null);
  const threadDialog = useRef<HTMLDivElement>(null);

  const logRef = useRef<HTMLElement>(null);
  const wide = useMediaQuery("(min-width: 1024px)");
  const split = useMediaQuery("(min-width: 1280px)");

  // Desktop thread panel: resizable beside the channel (remembered per browser) or maximized over it, Teams-style.
  const [threadWidth, setThreadWidth] = useState(THREAD_DEFAULT);
  const [threadMax, setThreadMax] = useState(false);
  const [chatWidth, setChatWidth] = useState(0);
  useEffect(() => {
    setThreadWidth(loadThreadWidth());
  }, []);
  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const measure = () => setChatWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const panelWidth = chatWidth > 0 ? clampThreadWidth(threadWidth, chatWidth) : threadWidth;
  const resizeThread = (w: number) => setThreadWidth(w);
  const savedWidth = useRef<number | null>(null);
  useEffect(() => {
    if (savedWidth.current === null) {
      savedWidth.current = threadWidth; // the loaded value: nothing to save
      return;
    }
    const t = setTimeout(() => saveThreadWidth(threadWidth), 400);
    return () => clearTimeout(t);
  }, [threadWidth]);

  const mergeDir = useCallback((extra: Directory) => setDirectory((d) => mergeDirectory(d, extra)), []);

  // --- read marks ---------------------------------------------------------------------------------

  const atBottom = useRef(true);
  const unreadDirty = useRef(false);
  const readInFlight = useRef(false);
  const readQueued = useRef(false);

  const doMarkRead = useCallback(function run() {
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
    void markChannelRead(createBrowserClient(), channelId)
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

  // At most one mark-read (and one event-driven unread refresh) per 5 s: busy channels emit bursts of events.
  const readThrottle = useRef<ReturnType<typeof createThrottle> | null>(null);
  const eventRefresh = useRef<ReturnType<typeof createThrottle> | null>(null);
  const refreshRef = useRef(refreshUnread);
  useEffect(() => {
    refreshRef.current = refreshUnread;
  });
  useEffect(() => {
    const throttle = createThrottle(doMarkRead, THROTTLE_MS);
    const refreshThrottle = createThrottle(() => refreshRef.current(), THROTTLE_MS);
    readThrottle.current = throttle;
    eventRefresh.current = refreshThrottle;
    // Landing in the middle of history does not mark the channel read: the newest messages have not been seen.
    if (!hasNewerRef.current) throttle.call();
    const onVisible = () => {
      if (document.visibilityState === "visible" && atBottom.current && unreadDirty.current && !hasNewerRef.current) throttle.call();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      throttle.cancel();
      refreshThrottle.cancel();
    };
  }, [doMarkRead]);

  const markRead = useCallback(() => {
    if (!hasNewerRef.current) readThrottle.current?.call();
  }, []);

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
    setRowKeys((k) => (id in k ? Object.fromEntries(Object.entries(k).filter(([realId]) => realId !== id)) : k));
    setPinned((l) => removeById(l, id));
    setThread((t) => {
      if (!t) return t;
      if (t.rootId === id) return null;
      return { ...t, replies: removeById(t.replies, id) };
    });
    if (threadRef.current?.rootId === id) {
      // The panel (and the focus inside it) vanishes: land on the message list instead of <body>.
      openerRef.current = null;
      requestAnimationFrame(() => logRef.current?.querySelector<HTMLElement>('[role="log"]')?.focus());
    }
  }, []);

  /** The pending message `key` is the real message `realId`: its row takes over the pending one. */
  const adopt = useCallback((key: string, realId: string) => {
    setRowKeys((k) => (k[realId] === key ? k : { ...k, [realId]: key }));
    updatePending((ps) => ps.map((p) => (p.key === key ? { ...p, realId } : p)));
  }, [updatePending]);

  /**
   * My messages that reached the timeline replace their pending rows: by the id the server answered, or by the key
   * they carry (`client_id`) when realtime or a resync brings them first. Never by text; never a refused one.
   */
  const adoptMine = useCallback(
    (list: readonly ChatMessage[]) => {
      const done = new Map<string, string>();
      for (const m of list) {
        if (m.authorId !== meId || m.threadRootId !== null) continue;
        const p = pendingRef.current.find((x) => x.realId === m.id || isEchoOf(x, m, meId));
        if (p) done.set(p.key, m.id);
      }
      if (done.size === 0) return;
      setRowKeys((k) => {
        const next = { ...k };
        for (const [key, realId] of done) next[realId] = key;
        return next;
      });
      updatePending((ps) => ps.filter((p) => !done.has(p.key)));
    },
    [meId, updatePending],
  );

  const apply = useCallback(
    (m: ChatMessage, created = false) => {
      if (m.threadRootId === null) {
        const list = rootsRef.current;
        const isNew = !list.some((x) => x.id === m.id);
        adoptMine([m]);
        // Only a freshly CREATED root counts as news: edits, reactions, pins, deletes and reply-driven reconciles do not.
        if (created && isNew && hasNewerRef.current && list.length > 0 && cmpMessages(m, list.at(-1)!) > 0) setPendingNew(true);
        if (created && isNew && m.authorId !== meId && !m.deletedAt) {
          setAnnouncement(m.authorId ? `Mensaje nuevo de ${directoryRef.current.members[m.authorId]?.name ?? "un miembro"}` : "Nuevo aviso de El Club");
        }
        setRoots((l) => applyToWindow(l, m, hasMoreRef.current, hasNewerRef.current));
        setPinned((l) => upsertPinned(l, m));
        setThread((t) => (t && t.rootId === m.id ? { ...t, root: m } : t));
      } else {
        setThread((t) => (t && t.rootId === m.threadRootId ? { ...t, replies: upsertSorted(t.replies, m) } : t));
      }
    },
    [meId, adoptMine],
  );

  /** A tip notice arrived: re-read the totals of the thread root and of the replies in the open thread. */
  const refreshTips = useCallback(
    async (rootId: string) => {
      const open = threadRef.current;
      const ids = [rootId, ...(open && open.rootId === rootId ? open.replies.filter((m) => m.kind !== "system").map((m) => m.id) : [])];
      const key = `tips:${rootId}`;
      const ticket = (requests.current.get(key) ?? 0) + 1;
      requests.current.set(key, ticket);
      const summaries = await getTipSummaries(createBrowserClient(), ids);
      // A failed read keeps the badges on screen; an older answer never overwrites a newer one.
      if (!summaries || requests.current.get(key) !== ticket) return;
      for (const id of ids) patchMessage(id, (m) => ({ ...m, tips: summaries.get(id) ?? [] }));
    },
    [patchMessage],
  );

  /** Re-reads one message through RLS and folds it into whatever is on screen. Stale answers are dropped. */
  const reconcile = useCallback(
    async (id: string, created = false) => {
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
      apply(result.message, created);
      // A "X ha enviado ..." notice means some message of that thread has new tip totals.
      if (result.message.kind === "system" && result.message.tipId && result.message.threadRootId) {
        void refreshTips(result.message.threadRootId);
      }
    },
    [apply, meId, mergeDir, refreshTips, remove],
  );

  const resync = useCallback(async () => {
    const supabase = createBrowserClient();
    try {
      const anchored = hasNewerRef.current;
      const loaded = rootsRef.current.map((m) => m.id);
      const [page, pins] = await Promise.all([
        // Anchored view: the newest page is not what is on screen, so the loaded window itself is re-read by id.
        anchored ? getMessagesByIds(supabase, loaded, meId) : getMessages(supabase, channelId, meId),
        getPinned(supabase, channelId, meId),
      ]);
      mergeDir(page.directory);
      mergeDir(pins.directory);
      if (anchored) {
        // Edits are applied and messages deleted for good while away are dropped; nothing is appended.
        const fresh = new Map(page.messages.map((m) => [m.id, m]));
        setRoots((l) => keepSignedUrls(l, l.flatMap((m) => fresh.get(m.id) ?? [])));
      } else {
        // The fresh newest page replaces the newest slice, so messages hard-deleted while away disappear.
        const newest = page as Awaited<ReturnType<typeof getMessages>>;
        setRoots((l) => replaceNewest(l, keepSignedUrls(l, newest.messages), newest.hasMore));
        if (!newest.hasMore) setHasMore(false);
        adoptMine(newest.messages);
        setQuietUntil(newest.messages.at(-1));
      }
      setPinned((l) => keepSignedUrls(l, pins.messages));
      const open = threadRef.current;
      if (open) {
        const t = await getThread(supabase, open.rootId, meId);
        mergeDir(t.directory);
        if (!t.root) remove(open.rootId);
        else {
          const root = t.root;
          setThread((cur) =>
            cur && cur.rootId === open.rootId
              ? {
                  ...cur,
                  root: keepSignedUrls(cur.root ? [cur.root] : [], [root])[0] ?? root,
                  replies: keepSignedUrls(cur.replies, t.replies),
                  loading: false,
                }
              : cur,
          );
        }
      }
    } catch {
      // the next event or resync catches up
    }
    refreshUnread();
  }, [adoptMine, channelId, meId, mergeDir, refreshUnread, remove]);

  useChannelEvents(
    channelId,
    (event: ChannelEvent) => {
      void reconcile(event.id, event.events.includes("message_created"));
      if (event.threadRootId) void reconcile(event.threadRootId);
      eventRefresh.current?.call();
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

  // A notification link names a thread that may be outside the loaded window: fetch it by id. The root must belong
  // to this channel (RLS already hides anything unreadable); otherwise the link is ignored.
  useEffect(() => {
    if (!initialThreadId) return;
    let cancelled = false;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setThread({ rootId: initialThreadId, root: null, replies: [], loading: true });
    void (async () => {
      try {
        const res = await getThread(createBrowserClient(), initialThreadId, meId);
        if (cancelled) return;
        if (!res.root || res.root.channelId !== channelId) {
          setThread((t) => (t && t.rootId === initialThreadId ? null : t));
          return;
        }
        mergeDir(res.directory);
        setThread((t) => (t && t.rootId === initialThreadId ? { rootId: initialThreadId, root: res.root, replies: res.replies, loading: false } : t));
      } catch {
        if (!cancelled) setThread((t) => (t && t.rootId === initialThreadId ? null : t));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialThreadId, channelId, meId, mergeDir]);

  // A thread opened from a notification link keeps `?thread=<id>` in the URL: drop it on close so a refresh or a
  // shared link does not reopen it. `replace` swaps the URL without adding a history entry or scrolling.
  const router = useRouter();
  const goLatest = useCallback(() => {
    // Dropping `m` (and `h`) changes the page's view key: the server renders the normal latest window and the chat
    // remounts on it. If this view is still here after a while the navigation failed: say so and allow a retry.
    setLatest("loading");
    if (latestTimer.current) clearTimeout(latestTimer.current);
    latestTimer.current = setTimeout(() => setLatest("error"), LATEST_TIMEOUT_MS);
    router.replace(`/c/${channelId}`, { scroll: false });
  }, [channelId, router]);
  const closeThread = useCallback(() => {
    if (!threadRef.current) return;
    setThread(null);
    // The thread of a reply anchor is derived from `m`, so `m` moves to the thread root (otherwise a refresh would
    // reopen it). A root anchor keeps `m` (and its nonce): only the thread goes away and the window stays.
    if (initialThreadId) {
      // A reply anchor goes back to its thread root (`?m=<root>`) so the reading position stays where the reply was.
      const keep = initialAnchorId
        ? anchorIsReply
          ? `?m=${initialThreadId}`
          : `?m=${initialAnchorId}${initialAnchorNonce ? `&h=${initialAnchorNonce}` : ""}`
        : "";
      router.replace(`/c/${channelId}${keep}`, { scroll: false });
    }
    const opener = openerRef.current;
    openerRef.current = null;
    requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus();
    });
  }, [initialThreadId, initialAnchorId, initialAnchorNonce, anchorIsReply, channelId, router]);

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
      const res = await editMessageAction({ id: message.id, doc: toPlainDoc(doc) });
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

  /** Marking is final (the server refuses a second mark): on success the bounty root is re-read to show its new status. */
  const markSolution = useCallback(
    async (reply: ChatMessage): Promise<string | null> => {
      const rootId = reply.threadRootId;
      if (!rootId) return rpcErrorMessage("unknown");
      const res = await markSolutionAction(rootId, reply.id).catch(() => null);
      if (!res) return rpcErrorMessage("unknown");
      // Also on a refusal: the bounty may already have changed (marked elsewhere, cancelled), and the card must say so.
      void reconcile(rootId);
      return res.ok ? null : res.error;
    },
    [reconcile],
  );

  // --- optimistic send ----------------------------------------------------------------------------

  const fail = useCallback((key: string, outcome: "rejected" | "unknown", error: string) => {
    // Already adopted (realtime or a resync brought it): it was sent, there is nothing to report.
    const p = pendingRef.current.find((x) => x.key === key);
    if (!p || p.realId) return;
    updatePending((ps) => ps.map((x) => (x.key === key ? { ...x, status: "failed", outcome, error } : x)));
    // The words change each time (a trailing no-break space toggles), so a repeated failure is read again.
    setAnnouncement((a) => (a === FAIL_COPY ? `${FAIL_COPY}\u00a0` : FAIL_COPY));
  }, [updatePending]);

  /** Posts a pending message once. A retry only calls this when nothing was written (see `retrySend`). */
  const deliver = useCallback(
    async (p: PendingMessage) => {
      const res = await postMessageAction({
        channelId,
        doc: p.doc,
        expanded: p.expanded,
        quotedId: p.quotedId,
        attachments: p.attachments.map((a) => a.uploaded),
        clientId: p.key,
      }).catch(() => null);
      const settled = settleOutcome(res);
      if (!mounted.current) {
        // The view is gone: a confirmed message leaves the stored copy (the next view reads it from the server); a
        // failed one stays there and comes back as a failed row.
        if (settled.ok) forgetPending(channelId, p.key);
        return res ?? { error: "unknown" };
      }
      if (settled.ok) {
        const id = settled.id;
        adopt(p.key, id);
        void reconcile(id, true);
        markRead();
        // The row already looks sent; if neither the re-read nor the echo brings the message, try once more.
        setTimeout(() => {
          if (mounted.current && pendingRef.current.some((x) => x.key === p.key)) void reconcile(id);
        }, CONFIRM_REREAD_MS);
      } else fail(p.key, settled.outcome, settled.error);
      return res ?? { error: "unknown" };
    },
    [adopt, channelId, fail, markRead, reconcile],
  );

  const sendOptimistic = useCallback(
    (out: OutgoingMessage) => {
      const quotedMsg = out.quotedId ? rootsRef.current.find((m) => m.id === out.quotedId) : undefined;
      const quoteText = quotedMsg ? docToPlainText(quotedMsg.body) : "";
      const p: PendingMessage = {
        ...out,
        key: crypto.randomUUID(),
        quote: quotedMsg
          ? {
              authorName: (quotedMsg.authorId ? directoryRef.current.members[quotedMsg.authorId]?.name : undefined) ?? "Miembro",
              text: quoteText.length > QUOTE_CHARS ? `${quoteText.slice(0, QUOTE_CHARS)}…` : quoteText,
              deleted: false,
            }
          : null,
        createdAt: new Date().toISOString(),
        status: "sending",
      };
      updatePending((ps) => [...ps, p]);
      setScrollKey((k) => k + 1);
      return deliver(p);
    },
    [deliver, updatePending],
  );

  /** Retry: a plain resend with the same key. The server returns the message if the first call did write it. */
  const retrySend = useCallback(
    async (key: string) => {
      const p = pendingRef.current.find((x) => x.key === key);
      if (!p || p.status !== "failed") return;
      updatePending((ps) => ps.map((x) => (x.key === key ? { ...x, status: "sending", outcome: undefined, error: undefined } : x)));
      setAnnouncement("");
      await deliver(p);
    },
    [deliver, updatePending],
  );

  const discardSend = useCallback((key: string) => updatePending((ps) => ps.filter((p) => p.key !== key)), [updatePending]);

  // The local image previews belong to the pending message: freed once it is confirmed, discarded or the chat unmounts.
  const shownPending = useRef<PendingMessage[]>([]);
  useEffect(() => {
    const keys = new Set(pending.map((p) => p.key));
    for (const p of shownPending.current) if (!keys.has(p.key)) for (const a of p.attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    shownPending.current = pending;
  }, [pending]);
  useEffect(
    () => () => {
      for (const p of shownPending.current) for (const a of p.attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
    },
    [],
  );

  const pendingViews = useMemo((): PendingView[] => {
    if (pending.length === 0) return NO_PENDING;
    // Between the server's answer and the re-read, the real message may already be in the list: show it once.
    const rootIds = new Set(roots.map((m) => m.id));
    return pending
      .filter((p) => !(p.realId && rootIds.has(p.realId)))
      .map((p) => ({
        message: pendingToMessage(p, meId, channelId),
        // The server answered with its id: it is sent, even before the re-read shows the real message.
        status: p.realId ? ("sent" as const) : p.status,
        error: p.error ? rpcErrorMessage(p.error) : null,
        onRetry: () => void retrySend(p.key),
        onDiscard: () => discardSend(p.key),
      }));
  }, [pending, roots, meId, channelId, retrySend, discardSend]);

  const bountyChanged = useCallback((message: ChatMessage) => void reconcile(message.id), [reconcile]);
  const pollChanged = bountyChanged;

  const quoteMessage = useCallback((message: ChatMessage) => {
    setQuoted({ id: message.id, authorName: (message.authorId ? directoryRef.current.members[message.authorId]?.name : undefined) ?? "Miembro" });
    requestAnimationFrame(() => composerBox.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus());
  }, []);

  // The 2 s highlight starts once the target is on screen (a reply may wait for its thread to load).
  const targetShown =
    highlightId !== null && (roots.some((m) => m.id === highlightId) || (thread?.replies.some((m) => m.id === highlightId) ?? false));
  const clearHighlight = useCallback(() => setHighlightId(null), []);
  useEffect(() => {
    if (!targetShown) return;
    setAnnouncement("Mostrando el mensaje seleccionado");
    const timer = setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [targetShown]);

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
    onBountyChanged: bountyChanged,
    onPollChanged: pollChanged,
  };

  const threadPanel = (inDialog: boolean) =>
    thread ? (
      <ThreadPanel
        key={thread.rootId}
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
        highlightId={highlightId}
        onTargetMissing={clearHighlight}
        inDialog={inDialog}
        onEdit={editMessage}
        onDelete={deleteMessage}
        onToggleReaction={itemHandlers.onToggleReaction}
        onBountyChanged={itemHandlers.onBountyChanged}
        onPollChanged={itemHandlers.onPollChanged}
        onMarkSolution={markSolution}
        maximized={!inDialog && threadMax}
        onToggleMaximize={inDialog ? undefined : () => setThreadMax((m) => !m)}
      />
    ) : null;

  return (
    <section
      ref={logRef}
      aria-label="Chat del canal"
      className="relative flex h-[calc(100dvh-13rem)] min-h-[28rem] md:h-[calc(100dvh-15.5rem)] overflow-hidden rounded-panel border border-border bg-bg"
    >
      {/* Outside the inert column: announcements still happen while a thread panel covers the list. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="flex min-w-0 flex-1 flex-col" inert={wide && thread !== null && (!split || threadMax)}>
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
          highlightId={highlightId}
          scrollToId={listScrollId}
          hasNewer={hasNewer}
          pendingNew={pendingNew}
          onGoLatest={goLatest}
          latest={latest}
          pending={pendingViews}
          rowKeys={rowKeys}
          quietUntil={quietUntil}
          {...itemHandlers}
        />

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
              canAlpha={channel.alphaEnabled === true && viewer.canEmbed === true && viewer.canPost === true}
              canBounty={viewer.canBounty === true && viewer.canPost === true}
              canPoll={viewer.canPoll === true && viewer.canPost === true}
              slowmodeSeconds={channel.slowmodeSeconds}
              quoted={quoted ?? undefined}
              onRemoveQuoted={() => setQuoted(null)}
              // An anchored view (`?m=`) jumps to the latest window after posting: no pending row to keep there.
              onSendOptimistic={hasNewer ? undefined : sendOptimistic}
              onPosted={(id) => {
                // A message sent from the middle of history lands at the end: show the latest window.
                if (hasNewerRef.current) {
                  goLatest();
                  return;
                }
                void reconcile(id);
                setScrollKey((k) => k + 1);
                markRead();
              }}
            />
          ) : (
            (postGate ?? <p className="border-t border-border bg-surface px-4 py-3 text-sm text-fg-muted">Este canal es de solo lectura.</p>)
          )}
        </div>
      </div>

      {thread && wide && split && !threadMax ? (
        <ThreadResizer width={panelWidth} min={THREAD_MIN} max={Math.max(THREAD_MIN, chatWidth - THREAD_MIN)} onChange={resizeThread} />
      ) : null}
      {thread && wide ? (
        <aside
          aria-label="Panel del hilo"
          style={threadMax ? undefined : { width: split ? panelWidth : undefined }}
          className={
            threadMax
              ? "absolute inset-0 z-10"
              : "absolute inset-y-0 right-0 z-10 w-[min(24rem,100%)] border-l border-border-strong xl:static xl:z-auto xl:w-auto xl:shrink-0"
          }
        >
          {threadPanel(false)}
        </aside>
      ) : null}

      <Dialog open={thread !== null && !wide} onOpenChange={(open) => !open && closeThread()}>
        <DialogContent
          ref={threadDialog}
          showCloseButton={false}
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => {
            // Escape belongs to whatever is open inside first: an inline edit, a mention/slash popup or a picker.
            const inside = threadDialog.current;
            const target = e.target instanceof Element ? e.target : null;
            const editing = target?.closest('[aria-label="Editar mensaje"]');
            if (editing) {
              e.preventDefault();
              editing.dispatchEvent(new Event(CANCEL_EDIT_EVENT, { bubbles: true }));
              return;
            }
            if (
              document.querySelector("[data-suggestion-popup]") ||
              inside?.querySelector('[aria-haspopup="true"][aria-expanded="true"]')
            ) {
              e.preventDefault();
            }
          }}
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
