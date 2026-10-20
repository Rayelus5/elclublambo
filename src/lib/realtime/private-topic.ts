"use client";

import { useEffect, useRef } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const REJOIN_AFTER_HIDDEN_MS = 30_000;
/**
 * How long a topic with no listeners stays joined. A navigation unmounts and remounts its listeners in the same moment
 * (the right rail on a channel switch): the new listener takes the channel over instead of a leave and a re-join.
 */
export const RELEASE_DELAY_MS = 1500;

export interface TopicHandlers {
  /** The subscribed event arrived; `payload` is whatever the database sent (validate before use). */
  onEvent?: (payload: unknown) => void;
  /** The socket was re-joined after a gap: events may have been missed. */
  onResync?: () => void;
}

interface Listener {
  event: string;
  handlers: { current: TopicHandlers };
}

interface Topic {
  listeners: Set<Listener>;
  release: ReturnType<typeof setTimeout> | null;
  close: () => void;
}

/** One realtime channel per topic for the whole page, shared by every component listening to it. */
const topics = new Map<string, Topic>();

/**
 * Joins `topic` and keeps it joined until `close()`. Same join/leave/retry pattern as `useTicketEvents`
 * (docs/superpowers/notes/2026-10-16-realtime-spike.md): the previous leave is awaited before every join, a failed
 * channel is removed before retrying (at most three times with backoff), and the socket is re-joined after a real
 * absence and on token refresh. Every broadcast goes to the listeners of its event.
 */
function openTopic(topic: string): Topic {
  const entry: Topic = { listeners: new Set(), release: null, close: () => {} };
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
    const zombie = supabase.getChannels().find((c) => c.topic === topic || c.topic === `realtime:${topic}`);
    if (zombie) {
      await Promise.resolve(supabase.removeChannel(zombie)).catch(() => undefined);
      if (cancelled || mine !== generation) return;
    }
    const { data } = await supabase.auth.getSession();
    if (cancelled || mine !== generation) return;
    await supabase.realtime.setAuth(data.session?.access_token);
    if (cancelled || mine !== generation) return;

    const channel = supabase.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "*" }, (message: { event?: string; payload?: unknown }) => {
      if (cancelled) return;
      for (const l of [...entry.listeners]) if (l.event === message.event) l.handlers.current.onEvent?.(message.payload);
    });
    current = channel;
    channel.subscribe((status: string) => {
      if (cancelled || mine !== generation) return;
      if (status === "SUBSCRIBED") {
        attempts = 0;
        if (joinedBefore) for (const l of [...entry.listeners]) l.handlers.current.onResync?.();
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

  entry.close = () => {
    cancelled = true;
    generation += 1;
    document.removeEventListener("visibilitychange", onVisibility);
    auth.subscription.unsubscribe();
    teardown();
  };
  return entry;
}

function listen(topic: string, listener: Listener): () => void {
  let entry = topics.get(topic);
  if (!entry) {
    entry = openTopic(topic);
    topics.set(topic, entry);
  }
  const mine = entry;
  if (mine.release) {
    clearTimeout(mine.release);
    mine.release = null;
  }
  mine.listeners.add(listener);
  return () => {
    mine.listeners.delete(listener);
    if (mine.listeners.size > 0 || mine.release) return;
    mine.release = setTimeout(() => {
      mine.release = null;
      if (mine.listeners.size > 0) return;
      mine.close();
      if (topics.get(topic) === mine) topics.delete(topic);
    }, RELEASE_DELAY_MS);
  };
}

/**
 * Private broadcast subscription to a fixed topic every active member may join ("dao", "activity", "presence"). All the
 * listeners of a topic share one channel, so a remount (a channel switch re-creating the right rail) or a second
 * listener (an open member card next to the rail's member list) neither leaves and re-joins nor evicts the other.
 */
export function usePrivateTopic(topic: string, event: string, handlers: TopicHandlers): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => listen(topic, { event, handlers: ref }), [topic, event]);
}
