"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

const TOPIC = "dao";
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const REJOIN_AFTER_HIDDEN_MS = 30_000;

export interface DaoEventHandlers {
  /** The treasury changed (donation recorded, credited or reverted; ranking opt-in): re-read it. */
  onChanged?: () => void;
  /** The socket was re-joined after a gap: events may have been missed. */
  onResync?: () => void;
}

/**
 * Private broadcast subscription to the `dao` topic (any active member may join; the payload carries only the chain).
 * Same join/leave/retry pattern as `useTicketEvents` (docs/superpowers/notes/2026-10-16-realtime-spike.md): the previous
 * leave is awaited before every join, a failed channel is removed before retrying (at most three times with backoff),
 * and the socket is re-joined after a real absence and on token refresh.
 */
export function useDaoEvents(handlers: DaoEventHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const supabase = createBrowserClient();
    let cancelled = false;
    let generation = 0;
    let attempts = 0;
    let joinedBefore = false;
    let current: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    let leaving: Promise<unknown> = Promise.resolve();
    const leave = (ch: NonNullable<typeof current>) => {
      leaving = Promise.all([leaving, Promise.resolve(supabase.removeChannel(ch)).catch(() => undefined)]);
    };
    const teardown = () => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (current) {
        const stale = current;
        current = null;
        leave(stale);
      }
    };

    const subscribe = async () => {
      teardown();
      const mine = ++generation;
      await leaving;
      if (cancelled || mine !== generation) return;
      const zombie = supabase.getChannels().find((c) => c.topic === TOPIC || c.topic === `realtime:${TOPIC}`);
      if (zombie) {
        await Promise.resolve(supabase.removeChannel(zombie)).catch(() => undefined);
        if (cancelled || mine !== generation) return;
      }
      const { data } = await supabase.auth.getSession();
      if (cancelled || mine !== generation) return;
      await supabase.realtime.setAuth(data.session?.access_token);
      if (cancelled || mine !== generation) return;

      const channel = supabase.channel(TOPIC, { config: { private: true } });
      channel.on("broadcast", { event: "dao_changed" }, () => {
        if (!cancelled) ref.current.onChanged?.();
      });
      current = channel;
      channel.subscribe((status: string) => {
        if (cancelled || mine !== generation) return;
        if (status === "SUBSCRIBED") {
          attempts = 0;
          if (joinedBefore) ref.current.onResync?.();
          joinedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (current === channel) current = null;
          leave(channel);
          if (attempts >= MAX_RETRIES) return;
          const delay = BASE_BACKOFF_MS * 2 ** attempts;
          attempts += 1;
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (!cancelled) void subscribe();
          }, delay);
        }
      });
    };

    const rejoin = () => {
      attempts = 0;
      void subscribe();
    };

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt ??= Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= REJOIN_AFTER_HIDDEN_MS) rejoin();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const { data: auth } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "TOKEN_REFRESHED") rejoin();
    });

    void subscribe();

    return () => {
      cancelled = true;
      generation += 1;
      document.removeEventListener("visibilitychange", onVisibility);
      auth.subscription.unsubscribe();
      teardown();
    };
  }, []);
}
