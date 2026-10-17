"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";

const POLL_MS = 60_000;
const EMPTY: ReadonlySet<string> = new Set();

interface UnreadContextValue {
  /** Ids of the visible text channels with messages newer than the member's read mark. */
  unread: ReadonlySet<string>;
  /** Asks the server again (coalesced: overlapping requests collapse into one trailing call). */
  refresh: () => void;
}

const UnreadContext = createContext<UnreadContextValue>({ unread: EMPTY, refresh: () => {} });

export const useUnread = () => useContext(UnreadContext);

/** Source of the sidebar's unread dots: `my_unread_channels`, refreshed on events, on demand and every 60 s. */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const [unread, setUnread] = useState<ReadonlySet<string>>(EMPTY);
  const inflight = useRef(false);
  const queued = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(function run() {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    void (async () => {
      try {
        const { data, error } = await createBrowserClient().rpc("my_unread_channels");
        if (!error && Array.isArray(data) && alive.current) {
          setUnread(new Set(data.filter((v): v is string => typeof v === "string")));
        }
      } catch {
        // keep the previous dots; the next tick tries again
      } finally {
        inflight.current = false;
        if (queued.current) {
          queued.current = false;
          if (alive.current) run();
        }
      }
    })();
  }, []);

  // Navigating is a natural moment to re-check (the channel just left may have gained messages).
  const pathname = usePathname();
  useEffect(() => {
    refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const value = useMemo(() => ({ unread, refresh }), [unread, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}
