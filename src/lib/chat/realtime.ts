"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

export const CHANNEL_EVENTS = [
  "message_created",
  "message_updated",
  "message_deleted",
  "message_pinned",
  "reaction_changed",
] as const;
export type ChannelEventName = (typeof CHANNEL_EVENTS)[number];

/** What a subscriber gets: ids only. The content is always re-read through RLS. */
export interface ChannelEvent {
  id: string;
  threadRootId: string | null;
  /** Every event name seen for this message during the debounce window. */
  events: ChannelEventName[];
}

export interface ChannelEventsOptions {
  /** Coalescing window per message id (a soft delete emits several events at once). */
  debounceMs?: number;
  /** The socket was re-joined after a gap (tab hidden, token refreshed, error): events may have been missed. */
  onResync?: () => void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const REJOIN_AFTER_HIDDEN_MS = 30_000;

type Pending = { timer: ReturnType<typeof setTimeout>; threadRootId: string | null; events: Set<ChannelEventName> };

/**
 * Private broadcast subscription to `channel:<id>` (see docs/superpowers/notes/2026-10-16-realtime-spike.md).
 *
 * - Authorization is evaluated when the socket joins the topic, so the socket is re-joined when the tab becomes
 *   visible again and when the access token is refreshed: that is where a revoked VIEW takes effect.
 * - A denied/failed join must be removed (`removeChannel`) or realtime-js keeps retrying it; we retry ourselves
 *   with a short backoff, at most three times.
 */
export function useChannelEvents(
  channelId: string,
  onEvent: (event: ChannelEvent) => void,
  options: ChannelEventsOptions = {},
): void {
  const handler = useRef(onEvent);
  const resync = useRef(options.onResync);
  const debounceMs = options.debounceMs ?? 150;
  useEffect(() => {
    handler.current = onEvent;
    resync.current = options.onResync;
  });

  useEffect(() => {
    const supabase = createBrowserClient();
    let cancelled = false;
    let generation = 0;
    let attempts = 0;
    let joinedBefore = false;
    let current: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Map<string, Pending>();

    const queue = (name: ChannelEventName, payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const { id, thread_root_id: root } = payload as { id?: unknown; thread_root_id?: unknown };
      if (typeof id !== "string" || !UUID_RE.test(id)) return;
      const threadRootId = typeof root === "string" && UUID_RE.test(root) ? root : null;
      const entry = pending.get(id);
      if (entry) {
        entry.events.add(name);
        return;
      }
      const events = new Set<ChannelEventName>([name]);
      const timer = setTimeout(() => {
        pending.delete(id);
        if (!cancelled) handler.current({ id, threadRootId, events: [...events] });
      }, debounceMs);
      pending.set(id, { timer, threadRootId, events });
    };

    // realtime-js keeps a channel registered until the leave is acknowledged, and channel(topic) hands back that same
    // (leaving) instance, whose subscribe() is then a no-op. So every join waits for the previous leave.
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
      // A leave that timed out resolves without unregistering the channel; channel(topic) would hand that zombie
      // back and the join would be a no-op. Remove it again before joining.
      const topic = `channel:${channelId}`;
      const zombie = supabase.getChannels().find((c) => c.topic === topic || c.topic === `realtime:${topic}`);
      if (zombie) {
        await Promise.resolve(supabase.removeChannel(zombie)).catch(() => undefined);
        if (cancelled || mine !== generation) return;
      }
      const { data } = await supabase.auth.getSession();
      if (cancelled || mine !== generation) return;
      // The socket authorizes with the user's JWT, not the anon key.
      await supabase.realtime.setAuth(data.session?.access_token);
      if (cancelled || mine !== generation) return;

      const channel = supabase.channel(`channel:${channelId}`, { config: { private: true } });
      for (const name of CHANNEL_EVENTS) {
        channel.on("broadcast", { event: name }, (message: { payload?: unknown }) => queue(name, message.payload));
      }
      current = channel;
      channel.subscribe((status: string) => {
        if (cancelled || mine !== generation) return;
        if (status === "SUBSCRIBED") {
          attempts = 0;
          if (joinedBefore) resync.current?.();
          joinedBefore = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Spike finding: leaving the failed channel registered stalls the next join.
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

    // A short tab switch keeps the socket healthy: only re-join (and resync) after a real absence.
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
      for (const entry of pending.values()) clearTimeout(entry.timer);
      pending.clear();
      teardown();
    };
  }, [channelId, debounceMs]);
}
