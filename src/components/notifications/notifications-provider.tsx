"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useNotificationEvents } from "@/lib/notifications/realtime";
import { createBrowserClient } from "@/lib/supabase/browser";

interface NotificationsContextValue {
  /** Unread notices the member can still see (same visibility rule as the inbox). */
  count: number;
  /** Bumps on every realtime event: the inbox list reloads its first page when it changes. */
  eventTick: number;
  /** Reads the count again from the server. */
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue>({ count: 0, eventTick: 0, refresh: () => {} });

export const useNotifications = () => useContext(NotificationsContext);

/**
 * One subscription to `member:<id>` for the whole shell. `memberId` comes from the server layout (never from client
 * input); the topic is authorized by the database anyway.
 */
export function NotificationsProvider({
  memberId,
  initialCount,
  children,
}: {
  memberId: string;
  initialCount: number;
  children: ReactNode;
}) {
  const [count, setCount] = useState(initialCount);
  const [eventTick, setEventTick] = useState(0);
  const alive = useRef(true);
  const inflight = useRef(false);
  const rerun = useRef(false);

  // A refresh requested while one is in flight may have been caused by something the running read did not see (a
  // notice read elsewhere, a resync): remember it and read once more when the current read ends.
  const refresh = useCallback(() => {
    if (inflight.current) {
      rerun.current = true;
      return;
    }
    inflight.current = true;
    void (async () => {
      try {
        do {
          rerun.current = false;
          try {
            const { data, error } = await createBrowserClient().rpc("my_unread_notification_count");
            if (!error && typeof data === "number" && alive.current) setCount(data);
          } catch {
            // keep the previous count; the next event or navigation tries again
          }
        } while (rerun.current && alive.current);
      } finally {
        rerun.current = false;
        inflight.current = false;
      }
    })();
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The count can drift (a channel lost, a notice read elsewhere): re-check when navigating.
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refresh();
  }, [pathname, refresh]);

  const onCreated = useCallback(() => {
    setCount((c) => c + 1);
    setEventTick((t) => t + 1);
  }, []);
  const onResync = useCallback(() => {
    refresh();
    setEventTick((t) => t + 1);
  }, [refresh]);
  useNotificationEvents(memberId, onCreated, { onResync });

  const value = useMemo(() => ({ count, eventTick, refresh }), [count, eventTick, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
