"use client";

import { useSyncExternalStore } from "react";
import { formatTime } from "@/lib/market/format";

const noop = () => () => {};

/**
 * HH:MM of an ISO instant in the viewer's own time zone. The server (and the hydration pass) render UTC, which is the
 * same everywhere, so there is no hydration mismatch; right after hydration the client snapshot replaces it with the
 * viewer's local time (useSyncExternalStore re-renders when the client snapshot differs from the server one).
 */
export function LocalClock({ iso }: { iso: string }) {
  const text = useSyncExternalStore(
    noop,
    () => formatTime(iso),
    () => formatTime(iso, { utc: true }),
  );
  return <time dateTime={iso}>{text}</time>;
}
