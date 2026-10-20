"use client";

import { useSyncExternalStore } from "react";
import { dayKey } from "@/lib/chat/timeline";

export interface ViewerDay {
  timeZone: string;
  /** Today's `dayKey` in that zone. */
  today: string;
}

// Re-check once a minute and when the tab comes back, so «Hoy» rolls over at midnight.
function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, 60_000);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onChange);
  };
}

// A string snapshot: stable between calls while nothing changes (useSyncExternalStore compares with Object.is). It is
// read on every render, so the Intl work is cached and redone at most once a second (the store ticks every minute).
let cached: { at: number; value: string } | null = null;
function snapshot(): string {
  const now = Date.now();
  if (cached && now - cached.at < 1000) return cached.value;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  cached = { at: now, value: `${timeZone}|${dayKey(new Date(now).toISOString(), timeZone) ?? ""}` };
  return cached.value;
}

const serverSnapshot = () => null;

/**
 * The viewer's time zone and today's date in it, for the day separators. The server (and the hydration pass) have
 * no time zone, so they get null and draw no separators: no hydration mismatch. Right after hydration the client
 * snapshot replaces it (the same pattern as LocalClock).
 */
export function useViewerDay(): ViewerDay | null {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!value) return null;
  const [timeZone, today] = value.split("|") as [string, string];
  return { timeZone, today };
}
