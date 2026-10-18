"use client";

import { useEffect } from "react";
import { touchPresence } from "@/lib/members/card";
import { BEAT_MS, forgetTab, otherLiveTabs, presenceDeviceId, rememberTab, sendLeave } from "@/lib/members/presence";
import { createBrowserClient } from "@/lib/supabase/browser";

/**
 * Keeps this member online while any tab is open (background tabs included, like a chat app) and says goodbye when
 * the last tab closes, so others see the change at once. The server stamps the session's own member and broadcasts
 * the online/offline transitions; a crash without goodbye times out after 75 s.
 */
export function PresenceHeartbeat() {
  useEffect(() => {
    const supabase = createBrowserClient();
    const tabId = crypto.randomUUID();
    const deviceId = presenceDeviceId();
    // pagehide cannot await anything: keep the access token at hand.
    let token: string | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      token = data.session?.access_token ?? null;
    });
    const { data: auth } = supabase.auth.onAuthStateChange((_event: string, session: { access_token?: string } | null) => {
      token = session?.access_token ?? null;
    });

    const beat = () => {
      rememberTab(tabId);
      void touchPresence(supabase, deviceId).catch(() => undefined);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    const onPageHide = () => {
      forgetTab(tabId);
      if (otherLiveTabs(tabId)) return;
      sendLeave({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        token,
        deviceId,
      });
    };

    beat();
    const timer = setInterval(beat, BEAT_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", beat);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", beat);
      window.removeEventListener("pagehide", onPageHide);
      auth.subscription.unsubscribe();
      forgetTab(tabId);
    };
  }, []);
  return null;
}
