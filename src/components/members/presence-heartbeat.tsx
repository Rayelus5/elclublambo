"use client";

import { useEffect } from "react";
import { touchPresence } from "@/lib/members/card";
import { createBrowserClient } from "@/lib/supabase/browser";

const EVERY_MS = 60_000;

/**
 * Tells the server this member is here: once on load, every minute while the tab is visible, and when it becomes
 * visible again. The server stamps the session's own member (online = seen in the last 3 minutes).
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const supabase = createBrowserClient();
    const beat = () => {
      if (document.visibilityState === "visible") void touchPresence(supabase).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, EVERY_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);
  return null;
}
