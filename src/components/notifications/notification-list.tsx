"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck } from "lucide-react";
import { NotificationItem } from "@/components/notifications/notification-item";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { Button } from "@/components/ui/button";
import { markNotificationsReadAction } from "@/lib/notifications/actions";
import { listNotifications, PAGE_SIZE, type NotificationFilter, type NotificationView } from "@/lib/notifications/queries";
import { rpcErrorMessage } from "@/lib/errors";
import { createBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "mentions", label: "Menciones" },
];

export function NotificationList({ initial, initialHasMore }: { initial: NotificationView[]; initialHasMore: boolean }) {
  const { eventTick, refresh } = useNotifications();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [items, setItems] = useState(initial);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  const load = useCallback(async (next: NotificationFilter) => {
    const mine = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const page = await listNotifications({ filter: next }, createBrowserClient());
      if (mine !== request.current) return;
      setItems(page);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      if (mine === request.current) setError(rpcErrorMessage("unknown"));
    } finally {
      if (mine === request.current) setBusy(false);
    }
  }, []);

  const changeFilter = (next: NotificationFilter) => {
    if (next === filter) return;
    setFilter(next);
    void load(next);
  };

  // A new notice arrived: re-read the first page (through RLS). Not on mount: the server already rendered it.
  const seenTick = useRef(eventTick);
  useEffect(() => {
    if (seenTick.current === eventTick) return;
    seenTick.current = eventTick;
    void load(filter);
  }, [eventTick, filter, load]);

  const loadMore = async () => {
    const last = items.at(-1);
    if (!last || busy) return;
    const mine = request.current;
    setBusy(true);
    setError(null);
    try {
      const page = await listNotifications(
        { filter, cursor: { createdAt: last.createdAt, id: last.id } },
        createBrowserClient(),
      );
      if (mine !== request.current) return;
      setItems((cur) => [...cur, ...page.filter((p) => !cur.some((c) => c.id === p.id))]);
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      setError(rpcErrorMessage("unknown"));
    } finally {
      setBusy(false);
    }
  };

  const markRead = async (ids: number[] | null) => {
    const res = await markNotificationsReadAction(ids).catch(() => ({ error: "unknown" }) as { error?: string });
    if (res.error) {
      setError(rpcErrorMessage(res.error));
      return;
    }
    const now = new Date().toISOString();
    setItems((cur) => cur.map((n) => (ids === null || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    refresh();
  };

  const hasUnread = items.some((n) => n.readAt === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtro" className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => changeFilter(f.id)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-control border px-4 text-sm font-bold outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                filter === f.id ? "border-accent text-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {hasUnread ? (
          <Button type="button" variant="secondary" onClick={() => void markRead(null)}>
            <CheckCheck aria-hidden />
            Marcar todo como leído
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="py-8 text-fg-muted">
          {filter === "mentions" ? "No tienes menciones ni respuestas todavía." : "No tienes avisos todavía. Cuando alguien te mencione o te responda, aparecerá aquí."}
        </p>
      ) : (
        <ul aria-label="Notificaciones" className="flex flex-col gap-1" aria-busy={busy}>
          {items.map((n) => (
            <NotificationItem key={n.id} notification={n} onOpen={(v) => (v.readAt === null ? void markRead([v.id]) : undefined)} />
          ))}
        </ul>
      )}

      {hasMore ? (
        <Button type="button" variant="outline" className="self-center" disabled={busy} onClick={() => void loadMore()}>
          Cargar más
        </Button>
      ) : null}
    </div>
  );
}
